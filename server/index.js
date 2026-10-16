import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { enrichRepo, probeRepoAccess } from "./repo.js";
import { renderPage } from "./browser.js";
import {
  DIRECTED_TOPIC_REQUIREMENTS,
  formatTopicRubric,
  isDirectedTopic,
  resolveTopicName,
} from "./topics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const DIST_DIR = path.join(__dirname, "..", "dist");

const PORT = Number(process.env.PORT || 3001);
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "").replace(/\/+$/, "");
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";

const OPEN_SOURCE_BONUS = 5;
const DIRECTED_TOPIC_BONUS = 10;

const app = express();
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, llm: Boolean(LLM_API_KEY && LLM_BASE_URL) });
});

async function readHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const BACKUP_DIR = path.join(DATA_DIR, "backups");

async function backupHistory() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const snapshot = path.join(BACKUP_DIR, `history-${day}.json`);
    try {
      await fs.access(snapshot);
    } catch {
      await fs.copyFile(HISTORY_FILE, snapshot);
    }
    await fs.copyFile(HISTORY_FILE, `${HISTORY_FILE}.bak`);
  } catch {
    // 备份失败不影响主流程
  }
}

async function writeHistory(list) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await backupHistory();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(list, null, 2), "utf8");
}

app.get("/api/history", async (_req, res) => {
  const items = await readHistory();
  let changed = false;
  for (const entry of items) {
    if (!entry?.batch?.items) continue;
    for (const item of entry.batch.items) {
      if (item && !item.id) {
        item.id = randomUUID();
        changed = true;
      }
    }
  }
  if (changed) await writeHistory(items);
  res.json({ items });
});

app.post("/api/history", async (req, res) => {
  const entry = req.body;
  if (!entry || typeof entry !== "object" || !entry.id) {
    return res.status(400).json({ error: "无效的历史记录" });
  }
  const list = await readHistory();
  const next = [entry, ...list.filter((e) => e && e.id !== entry.id)].slice(0, 100);
  await writeHistory(next);
  res.json({ ok: true, id: entry.id });
});

app.delete("/api/history/:id", async (req, res) => {
  const list = await readHistory();
  await writeHistory(list.filter((e) => e && e.id !== req.params.id));
  res.json({ ok: true });
});

const REVIEW_DECISIONS = new Set(["advance", "hold", "out"]);

app.patch("/api/history/:id/decision", async (req, res) => {
  const { itemId, decision } = req.body || {};
  const list = await readHistory();
  const entry = list.find((e) => e && e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "未找到该记录" });
  if (!entry.batch || !Array.isArray(entry.batch.items)) {
    return res.status(400).json({ error: "该记录不是批量评分" });
  }
  const item = entry.batch.items.find((it) => it && it.id === itemId);
  if (!item) return res.status(400).json({ error: "未找到该应用" });
  if (REVIEW_DECISIONS.has(decision)) item.decision = decision;
  else delete item.decision;
  await writeHistory(list);
  res.json({ ok: true, decision: item.decision ?? null });
});

app.patch("/api/history/:id/items/:itemId", async (req, res) => {
  const list = await readHistory();
  const entry = list.find((e) => e && e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "未找到该记录" });
  if (!entry.batch || !Array.isArray(entry.batch.items)) {
    return res.status(400).json({ error: "该记录不是批量评分" });
  }
  const index = entry.batch.items.findIndex(
    (it) => it && it.id === req.params.itemId,
  );
  if (index === -1) return res.status(400).json({ error: "未找到该应用" });
  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const current = entry.batch.items[index];
  const merged = { ...current, ...patch, id: current.id };
  if (patch.report && typeof patch.report === "object") {
    merged.report = { ...current.report, ...patch.report };
  }
  entry.batch.items[index] = merged;
  await writeHistory(list);
  res.json({ ok: true, item: merged });
});

app.patch("/api/history/:id", async (req, res) => {
  const list = await readHistory();
  const index = list.findIndex((e) => e && e.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "未找到该记录" });
  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const current = list[index];
  const merged = { ...current, ...patch, id: current.id };
  if (
    patch.batch &&
    typeof patch.batch === "object" &&
    current.batch &&
    typeof current.batch === "object"
  ) {
    merged.batch = { ...current.batch, ...patch.batch };
    if (
      Array.isArray(current.batch.items) &&
      !Array.isArray(merged.batch.items)
    ) {
      merged.batch.items = current.batch.items;
    }
  }
  list[index] = merged;
  await writeHistory(list);
  res.json({ ok: true, item: list[index] });
});

app.post("/api/check-repos", async (req, res) => {  const urls = Array.isArray(req.body?.urls)
    ? req.body.urls.filter((u) => typeof u === "string" && u.trim())
    : [];
  if (!urls.length) return res.json({ results: {} });

  const unique = [...new Set(urls.map((u) => u.trim()))];
  const results = {};
  const limit = 5;
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const url = unique[cursor++];
      try {
        results[url] = await probeRepoAccess(url);
      } catch {
        results[url] = { accessible: false, private: true, status: 0, note: "探测失败" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, unique.length) }, worker));
  res.json({ results });
});

function decodeEntities(input) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

const PLATFORM_TITLE = /卡奥斯\s*COSMO\s*Code|COSMO\s*Code-AI|智能代码生成平台/i;

function cleanName(raw) {
  return decodeEntities(String(raw || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isUsableName(name) {
  return !!name && !PLATFORM_TITLE.test(name);
}

function metaContent(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const keyMatch = tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i);
    if (!keyMatch || keyMatch[1].toLowerCase() !== key.toLowerCase()) continue;
    const content = tag.match(/content\s*=\s*["']([\s\S]*?)["']/i);
    if (content) return content[1];
  }
  return "";
}

function extractStaticName(html) {
  const candidates = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) candidates.push(title[1]);
  for (const key of [
    "og:title",
    "twitter:title",
    "application-name",
    "apple-mobile-web-app-title",
  ]) {
    const value = metaContent(html, key);
    if (value) candidates.push(value);
  }
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) candidates.push(h1[1]);
  for (const candidate of candidates) {
    const name = cleanName(candidate);
    if (isUsableName(name)) return name;
  }
  return "";
}

function nameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "";
    if (/^[0-9a-f]{8}(-[0-9a-f]{4})+/i.test(last)) {
      return `应用 ${last.slice(0, 8)}`;
    }
    const sub = parsed.hostname.split(".")[0] || "";
    const subMatch = sub.match(/^\d+-([0-9a-f]{8,})$/i);
    if (subMatch) return `应用 ${subMatch[1].slice(0, 8)}`;
    if (
      last &&
      !/^(console|app-detail|index|home|article-detils)$/i.test(last)
    ) {
      return decodeURIComponent(last);
    }
  } catch {
    // ignore
  }
  return "";
}

async function probeAppLink(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 PreReviewBot/1.0" },
    });
    return { status: resp.status, ok: resp.ok };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAppName(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 PreReviewBot/1.0" },
    });
    const status = resp.status;
    if (!resp.ok) {
      return { name: "", status, note: `HTTP ${status}` };
    }
    const html = (await resp.text()).slice(0, 300000);
    const staticName = extractStaticName(html);
    if (staticName) return { name: staticName, status, note: "" };
  } catch (err) {
    return { name: "", status: 0, note: err.message };
  } finally {
    clearTimeout(timer);
  }

  const rendered = await renderPage(url).catch(() => ({ ok: false }));
  if (rendered && rendered.ok) {
    for (const candidate of [rendered.h1, rendered.ogTitle, rendered.title]) {
      const name = cleanName(candidate);
      if (isUsableName(name)) {
        return { name, status: 200, note: "静态标题为平台默认，已用无头浏览器渲染" };
      }
    }
  }

  const fallback = nameFromUrl(url);
  if (fallback) {
    return { name: fallback, status: 200, note: "未能解析页面标题，使用链接生成名称" };
  }
  return { name: "", status: 200, note: "未找到页面标题" };
}

app.post("/api/resolve-names", async (req, res) => {
  const urls = Array.isArray(req.body?.urls)
    ? req.body.urls.filter((u) => typeof u === "string" && u.trim())
    : [];
  if (!urls.length) return res.json({ results: {} });

  const unique = [...new Set(urls.map((u) => u.trim()))];
  const results = {};
  const limit = 5;
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const url = unique[cursor++];
      try {
        results[url] = await resolveAppName(url);
      } catch {
        results[url] = { name: "", note: "解析失败" };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, unique.length) }, worker));
  res.json({ results });
});

async function fetchPageText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 PreReviewBot/1.0" },
    });
    const contentType = resp.headers.get("content-type") || "";
    const raw = await resp.text();

    if (!resp.ok) {
      return { ok: false, text: "", status: resp.status, error: `HTTP ${resp.status}` };
    }

    const looksHtml = /html|xml/i.test(contentType) || /^\s*</.test(raw);
    const isBinary = /^(video|audio|image)\//i.test(contentType);

    if (isBinary || (!looksHtml && contentType && !/text|json|xml/i.test(contentType))) {
      return {
        ok: false,
        text: "",
        status: resp.status,
        error: `非文本内容（${contentType.split(";")[0] || "未知类型"}），无法解析为评审依据`,
      };
    }

    const text = looksHtml
      ? raw
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim()
      : raw.replace(/\s+/g, " ").trim();

    return { ok: true, text: text.slice(0, 8000), status: resp.status };
  } catch (err) {
    return { ok: false, text: "", error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

const LINK_FIELDS = [
  { key: "cosmocodeUrl", label: "COSMO Code 应用链接" },
  { key: "openlabUrl", label: "OpenLab 文章链接" },
  { key: "repoUrl", label: "开源代码仓" },
];

async function collectPageSmart(url) {
  let staticText = "";
  let staticError = "";
  const stat = await fetchPageText(url);
  if (stat.ok) staticText = stat.text;
  else staticError = stat.error || "抓取失败";

  if (staticText.length >= 300) {
    return { ok: true, text: staticText, note: "" };
  }

  const rendered = await renderPage(url);
  if (rendered.ok && rendered.text.length > staticText.length) {
    return { ok: true, text: rendered.text, note: "静态内容较少，已用无头浏览器渲染" };
  }
  if (staticText) {
    return { ok: true, text: staticText, note: "" };
  }
  return { ok: false, text: "", note: rendered.note || staticError };
}

async function collectAllPages(links) {
  const tasks = LINK_FIELDS.map(async ({ key, label }) => {
    const url = (links[key] || "").trim();
    if (!url) {
      return { key, label, url: "", ok: false, chars: 0, text: "", note: "未填写" };
    }

    let result;
    if (key === "repoUrl") {
      const r = await enrichRepo(url);
      result = r.ok
        ? { ok: true, text: r.text, note: r.note || "" }
        : { ok: false, text: "", note: r.note };
    } else {
      result = await collectPageSmart(url);
    }

    if (!result.ok || !result.text) {
      return {
        key,
        label,
        url,
        ok: false,
        chars: 0,
        text: "",
        note: result.note || "未获取到内容",
      };
    }
    const text = result.text.slice(0, 6000);
    return {
      key,
      label,
      url,
      ok: true,
      chars: text.length,
      text,
      note: result.note || "",
    };
  });

  return Promise.all(tasks);
}

function buildMessages({ track, topic, links, dimensions, pages, directed }) {
  const autoDimensions = dimensions.filter((d) => !isManualDimension(d.key));
  const dimLines = autoDimensions
    .map((d, i) => `${i + 1}. ${d.name}（key=${d.key}，权重${d.weight}%）：${d.description}`)
    .join("\n");
  const linkLines = [
    `- 赛道：${track || "未填写"}`,
    `- 赛题：${topic}`,
    `- COSMO Code 应用链接：${links.cosmocodeUrl || "未填写"}`,
    `- OpenLab 文章链接：${links.openlabUrl || "未填写"}`,
    `- 开源代码仓：${links.repoUrl || "未填写"}`,
  ].join("\n");

  const evidence = pages
    .map((p) => {
      if (!p.url) return `【${p.label}】未填写`;
      if (p.ok) return `【${p.label}】${p.url}\n${p.text}`;
      return `【${p.label}】${p.url}\n（无法作为评审依据：${p.note}）`;
    })
    .join("\n\n");

  const rubricBlock = formatTopicRubric(topic, dimensions);

  const system =
    "你是一位严谨的智能应用评审专家。请根据赛道、赛题要求及申报材料对参赛系统进行预审打分。" +
    "评审必须基于下方逐条列出的抓取内容；若某来源缺失或无法解析，应在相应维度的评分理由中说明依据不足。" +
    "评分须结合赛题专属的评分标准与基础/加分指标，突出该赛题关注的重点。" +
    (directed
      ? "此外需独立判断申报材料是否实际满足定向赛题要求，该判断仅用于标记提示，不影响评分。" +
        "仅当材料明显体现出与赛题要求不符时判定为不满足；材料不足或无有效内容时判定为满足（不做标记）。"
      : "") +
    "每个维度满分100分，取0-100的整数。必须严格输出 JSON，不要输出任何多余文字。";

  let user =
    `【申报信息】\n${linkLines}\n\n` +
    `【逐条抓取内容（共 ${pages.filter((p) => p.ok).length}/${pages.filter((p) => p.url).length} 条成功）】\n${evidence}\n\n` +
    `【评分维度】\n${dimLines}` +
    rubricBlock +
    `\n\n请输出 JSON，格式为：` +
    `{"summary":"总体评语，120字以内","dimensions":[{"key":"维度key","name":"维度名称","score":整数,"reason":"评分理由，80字以内，需引用具体来源"}]` +
    (directed
      ? `,"topicConformance":{"conforms":布尔,"reason":"是否符合赛题要求的判断理由，60字以内"}`
      : "") +
    `}。` +
    `dimensions 必须包含且仅包含上述维度，key 必须与给定一致。`;

  if (directed) {
    user +=
      `\n\n【定向赛题校验】本赛题为定向揭榜赛题「${directed.topic}」，要求：${directed.requirement}` +
      `请依据上述抓取内容判断该应用是否实际满足该赛题要求，并输出 topicConformance 字段：` +
      `conforms=true 表示满足（材料能证明符合要求，或材料不足以判断）；conforms=false 仅用于材料明显不符合赛题要求的情况。` +
      `reason 用一句话说明判断依据。`;
  }

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function buildConformanceMessages({ name, topic, requirement, pages }) {
  const evidence = pages
    .map((p) => {
      if (!p.url) return `【${p.label}】未填写`;
      if (p.ok) return `【${p.label}】${p.url}\n${p.text}`;
      return `【${p.label}】${p.url}\n（无法作为评审依据：${p.note}）`;
    })
    .join("\n\n");

  const system =
    "你是赛事评审专家。请判断参赛应用是否实际满足定向赛题要求。只输出 JSON，不要输出任何多余文字。" +
    "仅当材料明显体现出与赛题要求不符时才判定不满足；材料不足或无有效内容时判定为满足（不做标记）。";

  const user =
    `【应用名称】${name || "未命名应用"}\n` +
    `【赛题】${topic}\n` +
    `【赛题要求】${requirement}\n\n` +
    `【逐条抓取内容（共 ${pages.filter((p) => p.ok).length}/${pages.filter((p) => p.url).length} 条成功）】\n${evidence}\n\n` +
    `请输出 JSON：{"topicConformance":{"conforms":布尔,"reason":"判断理由，60字以内"}}。` +
    `conforms=true 表示满足（含材料不足的情况）；conforms=false 仅用于材料明显不符合赛题要求的情况。`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function buildCalibrateMessages(dimensions, items) {
  const autoDimensions = dimensions.filter((d) => !isManualDimension(d.key));
  const dimLines = autoDimensions
    .map((d, i) => `${i + 1}. ${d.name}（key=${d.key}，权重${d.weight}%）：${d.description || ""}`)
    .join("\n");
  const itemLines = items
    .map((it) => {
      const idx = Number(it.index);
      const scores = (Array.isArray(it.dimensions) ? it.dimensions : [])
        .filter((d) => !isManualDimension(d.key) && d.score != null)
        .map((d) => `${d.name || d.key}=${d.score}`)
        .join("，");
      return `#${idx} ${it.name || "未命名"}｜赛题：${it.topic || "-"}｜初评：${scores}｜概述：${String(it.summary || "").slice(0, 80)}`;
    })
    .join("\n");

  const system =
    "你是评审校准专家。请对同一批次全部参赛应用在相同评分维度上进行横向比对（全局控制），" +
    "在保持各应用相对优劣顺序基本不变的前提下，对分数进行小幅微调（一般不超过 ±8 分），" +
    "消除评审尺度不一致，使同一维度跨应用可比，避免普遍虚高或分数扎堆。只输出 JSON，不要输出多余文字。";

  const user =
    `【评分维度】\n${dimLines}\n\n` +
    `【各应用初评分数】\n${itemLines}\n\n` +
    `请输出 JSON，为每个应用在每个维度给出微调后的整数分（0-100）：` +
    `{"items":[{"index":序号,"dimensions":[{"key":"维度key","score":整数}]}]}。` +
    `必须包含全部应用与上述全部维度，key 与给定一致。`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function callLLM(messages) {
  const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`大模型接口错误 ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

function extractJson(content) {
  if (!content) throw new Error("大模型返回为空");
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("大模型未返回有效 JSON");
  return JSON.parse(content.slice(start, end + 1));
}

function clampScore(value, fallback = 60) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function dimensionFallback(key) {
  return key === "cosmoUsage" ? 0 : 60;
}

const MANUAL_DIMENSION_KEYS = new Set(["cosmoUsage"]);
const MANUAL_DIMENSION_REASON = "该维度暂不自动评分，留待人工评分。";

function isManualDimension(key) {
  return MANUAL_DIMENSION_KEYS.has(key);
}

function validateAppLink(raw) {
  const value = (raw || "").trim();
  if (!value) return { status: "empty", message: "未填写" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { status: "error", message: "链接格式无效" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { status: "error", message: "链接需以 http:// 或 https:// 开头" };
  }
  const host = url.hostname.toLowerCase();
  if (host !== "code.cosmoplat.cn" && !host.endsWith(".code.cosmoplat.cn")) {
    return {
      status: "error",
      message:
        "应形如 https://<端口>-<hash>.code.cosmoplat.cn 或 https://code.cosmoplat.cn/console/app-detail/<id>",
    };
  }
  return { status: "ok", message: "格式正确" };
}

function zeroReport(dimensions, model, links, message) {
  const normalized = dimensions.map((d) => ({
    key: d.key,
    name: d.name,
    weight: Number(d.weight) || 0,
    score: isManualDimension(d.key) ? null : 0,
    reason: isManualDimension(d.key) ? MANUAL_DIMENSION_REASON : message,
  }));
  const sources = LINK_FIELDS.map(({ key, label }) => ({
    key,
    label,
    url: (links && links[key]) || "",
    ok: false,
    chars: 0,
    note: "应用链接无效，未抓取内容",
  }));
  return {
    total: 0,
    fiveDimScore: 0,
    openSourceBonus: 0,
    directedTopicBonus: 0,
    openSourceReason: "",
    dimensions: normalized,
    summary: message,
    mode: "llm",
    model,
    sources,
    disqualified: true,
    generatedAt: new Date().toISOString(),
  };
}

function weightedTotal(items) {
  const totalWeight = items.reduce(
    (sum, d) => sum + (Number(d.weight) > 0 ? Number(d.weight) : 0),
    0,
  );
  if (totalWeight <= 0) {
    return Math.round(items.reduce((sum, d) => sum + d.score, 0) / items.length);
  }
  return Math.round(
    items.reduce((sum, d) => sum + d.score * (Number(d.weight) || 0), 0) / totalWeight,
  );
}

function toSources(pages) {
  return pages.map((p) => ({
    key: p.key,
    label: p.label,
    url: p.url,
    ok: p.ok,
    chars: p.chars,
    note: p.note,
  }));
}

function bonusBreakdown(fiveDimScore, repoUrl, repoAccessible, topic) {
  const hasRepo = Boolean((repoUrl || "").trim());
  const openSourceBonus =
    hasRepo && repoAccessible === true ? OPEN_SOURCE_BONUS : 0;
  const directedTopicBonus = isDirectedTopic(topic) ? DIRECTED_TOPIC_BONUS : 0;
  return {
    fiveDimScore,
    openSourceBonus,
    directedTopicBonus,
    total: fiveDimScore + openSourceBonus + directedTopicBonus,
  };
}

function parseConformance(parsed, directed) {
  if (!directed) return undefined;
  const raw = parsed && typeof parsed.topicConformance === "object" ? parsed.topicConformance : null;
  const conforms = raw ? raw.conforms !== false : true;
  const reason =
    raw && typeof raw.reason === "string" && raw.reason.trim()
      ? raw.reason.trim()
      : "";
  return { required: true, conforms, reason };
}

function normalize(parsed, dimensions, mode, model, sources = [], context = {}) {
  const byKey = new Map();
  const list = Array.isArray(parsed?.dimensions) ? parsed.dimensions : [];
  for (const item of list) {
    if (item && typeof item.key === "string") byKey.set(item.key, item);
  }

  const normalized = dimensions.map((d) => {
    if (isManualDimension(d.key)) {
      return {
        key: d.key,
        name: d.name,
        weight: Number(d.weight) || 0,
        score: null,
        reason: MANUAL_DIMENSION_REASON,
      };
    }
    const raw = byKey.get(d.key);
    return {
      key: d.key,
      name: d.name,
      weight: Number(d.weight) || 0,
      score: clampScore(raw?.score, dimensionFallback(d.key)),
      reason:
        (raw && typeof raw.reason === "string" && raw.reason.trim()) ||
        "暂无评分说明。",
    };
  });

  const fiveDimScore = weightedTotal(normalized);
  const repoTrimmed = String(context.repoUrl || "").trim();
  const hasRepo = Boolean(repoTrimmed);
  const repoAccessible = context.repoAccessible === true;
  const bonus = bonusBreakdown(
    fiveDimScore,
    context.repoUrl,
    repoAccessible,
    context.topic,
  );

  return {
    ...bonus,
    directedTopicCheck: parseConformance(parsed, context.directed),
    openSourceReason: hasRepo
      ? repoAccessible
        ? `开源代码仓可公开访问，加 ${OPEN_SOURCE_BONUS} 分。`
        : "开源代码仓不可访问，未获得开源加分。"
      : "",
    dimensions: normalized,
    summary:
      (parsed && typeof parsed.summary === "string" && parsed.summary.trim()) ||
      "已完成各维度预审打分，详见下方说明。",
    mode,
    model,
    sources,
    generatedAt: new Date().toISOString(),
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function mockReport(dimensions, seed, sources = [], context = {}) {
  const base = hash(seed);
  const normalized = dimensions.map((d, i) => ({
    key: d.key,
    name: d.name,
    weight: Number(d.weight) || 0,
    score: isManualDimension(d.key) ? null : 60 + ((base >> (i * 3)) % 36),
    reason: isManualDimension(d.key)
      ? "（演示数据）" + MANUAL_DIMENSION_REASON
      : `（演示数据）依据赛道、赛题与申报材料，${d.name}维度表现处于中等偏上水平。配置大模型后可获得真实评审意见。`,
  }));
  const fiveDimScore = weightedTotal(normalized);
  const bonus = bonusBreakdown(
    fiveDimScore,
    context.repoUrl,
    context.repoAccessible !== false,
    context.topic,
  );
  return {
    ...bonus,
    openSourceReason: bonus.openSourceBonus
      ? "（演示数据）已填写开源代码仓，默认视为可公开访问。"
      : "",
    dimensions: normalized,
    summary:
      "当前为演示模式：未配置大模型接口，分数为模拟值。配置 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL 后即为真实智能评分。",
    mode: "mock",
    sources,
    generatedAt: new Date().toISOString(),
  };
}

app.post("/api/score", async (req, res) => {
  const {
    track = "",
    topic = "",
    cosmocodeUrl = "",
    openlabUrl = "",
    repoUrl = "",
    dimensions,
  } = req.body || {};

  if (typeof topic !== "string" || !topic.trim()) {
    return res.status(400).json({ error: "请选择赛题" });
  }
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    return res.status(400).json({ error: "缺少评分维度配置" });
  }

  const links = {
    cosmocodeUrl: String(cosmocodeUrl || "").trim(),
    openlabUrl: String(openlabUrl || "").trim(),
    repoUrl: String(repoUrl || "").trim(),
  };
  if (!links.cosmocodeUrl && !links.openlabUrl && !links.repoUrl) {
    return res.status(400).json({ error: "请至少填写一个链接" });
  }

  const seed = `${track}::${topic}::${links.cosmocodeUrl || links.openlabUrl || links.repoUrl}`;

  const appCheck = validateAppLink(links.cosmocodeUrl);
  if (appCheck.status !== "ok") {
    const reason =
      appCheck.status === "empty"
        ? "未填写 COSMO Code应用链接，按规则直接计 0 分。"
        : `COSMO Code应用链接格式无效（${appCheck.message}），按规则直接计 0 分。`;
    return res.json(zeroReport(dimensions, LLM_MODEL, links, reason));
  }

  const reach = await probeAppLink(links.cosmocodeUrl);
  if (!reach.ok) {
    const reason = reach.status
      ? `COSMO Code应用链接不可访问（HTTP ${reach.status}），按规则直接计 0 分。`
      : "COSMO Code应用链接无法访问，按规则直接计 0 分。";
    return res.json(zeroReport(dimensions, LLM_MODEL, links, reason));
  }

  let repoAccessible = false;
  if (links.repoUrl) {
    try {
      const access = await probeRepoAccess(links.repoUrl);
      repoAccessible = Boolean(access?.accessible);
    } catch {
      repoAccessible = false;
    }
  }

  try {
    if (!LLM_API_KEY || !LLM_BASE_URL) {
      const mockSources = toSources(
        LINK_FIELDS.map(({ key, label }) => ({
          key,
          label,
          url: links[key],
          ok: false,
          chars: 0,
          note: links[key] ? "演示模式未抓取" : "未填写",
        })),
      );
      return res.json(
        mockReport(dimensions, seed, mockSources, {
          topic: resolveTopicName(topic) || topic,
          repoUrl: links.repoUrl,
          repoAccessible,
        }),
      );
    }

    const pages = await collectAllPages(links);
    const sources = toSources(pages);

    const resolvedTopic = resolveTopicName(topic) || String(topic || "").trim();
    const directedRequirement = DIRECTED_TOPIC_REQUIREMENTS[resolvedTopic];
    const directed = directedRequirement
      ? { topic: resolvedTopic, requirement: directedRequirement }
      : undefined;

    const messages = buildMessages({
      track: String(track || "").trim(),
      topic: resolvedTopic,
      links,
      dimensions,
      pages,
      directed,
    });

    const content = await callLLM(messages);
    const parsed = extractJson(content);
    return res.json(normalize(parsed, dimensions, "llm", LLM_MODEL, sources, { topic: resolvedTopic, repoUrl: links.repoUrl, repoAccessible, directed }));
  } catch (err) {
    return res.status(500).json({
      error: `评分失败：${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

app.post("/api/verify-topic", async (req, res) => {
  const { topic = "", name = "", links = {} } = req.body || {};
  const resolvedTopic = resolveTopicName(topic) || String(topic || "").trim();
  const directedRequirement = DIRECTED_TOPIC_REQUIREMENTS[resolvedTopic];
  if (!directedRequirement) {
    return res.json({ required: false });
  }
  if (!LLM_API_KEY || !LLM_BASE_URL) {
    return res.json({
      required: true,
      conforms: true,
      reason: "未配置大模型，跳过定向赛题校验。",
    });
  }
  const normalizedLinks = {
    cosmocodeUrl: String(links.cosmocodeUrl || "").trim(),
    openlabUrl: String(links.openlabUrl || "").trim(),
    repoUrl: String(links.repoUrl || "").trim(),
  };
  try {
    const pages = await collectAllPages(normalizedLinks);
    const messages = buildConformanceMessages({
      name,
      topic: resolvedTopic,
      requirement: directedRequirement,
      pages,
    });
    const content = await callLLM(messages);
    const parsed = extractJson(content);
    const check = parseConformance(parsed, {
      topic: resolvedTopic,
      requirement: directedRequirement,
    });
    return res.json({
      required: true,
      conforms: check.conforms,
      reason: check.reason,
    });
  } catch (err) {
    return res.status(500).json({
      error: `校验失败：${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

app.post("/api/calibrate", async (req, res) => {
  const { dimensions, items } = req.body || {};

  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    return res.status(400).json({ error: "缺少评分维度配置" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "缺少待校准记录" });
  }

  const fallback = () =>
    items.map((it, i) => ({
      index: Number(it.index ?? i),
      dimensions: dimensions.map((d) => {
        if (isManualDimension(d.key)) return { key: d.key, score: null };
        const found = (Array.isArray(it.dimensions) ? it.dimensions : []).find(
          (x) => x.key === d.key,
        );
        return { key: d.key, score: clampScore(found?.score) };
      }),
    }));

  if (!LLM_API_KEY || !LLM_BASE_URL) {
    return res.json({ items: fallback(), mode: "mock" });
  }

  try {
    const messages = buildCalibrateMessages(dimensions, items);
    const content = await callLLM(messages);
    const parsed = extractJson(content);
    const list = Array.isArray(parsed?.items) ? parsed.items : [];
    const byIndex = new Map();
    for (const it of list) {
      if (it && Number.isFinite(Number(it.index))) byIndex.set(Number(it.index), it);
    }

    const result = items.map((it, i) => {
      const idx = Number(it.index ?? i);
      const found = byIndex.get(idx);
      const scoreByKey = new Map();
      for (const d of Array.isArray(found?.dimensions) ? found.dimensions : []) {
        if (d && typeof d.key === "string") scoreByKey.set(d.key, clampScore(d.score));
      }
      return {
        index: idx,
        dimensions: dimensions.map((d) => {
          if (isManualDimension(d.key)) return { key: d.key, score: null };
          if (scoreByKey.has(d.key)) return { key: d.key, score: scoreByKey.get(d.key) };
          const origin = (Array.isArray(it.dimensions) ? it.dimensions : []).find(
            (x) => x.key === d.key,
          );
          return { key: d.key, score: clampScore(origin?.score) };
        }),
      };
    });

    return res.json({ items: result, mode: "llm" });
  } catch (err) {
    return res.status(500).json({
      error: `校准失败：${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

const distReady = await fs
  .access(path.join(DIST_DIR, "index.html"))
  .then(() => true)
  .catch(() => false);

if (distReady) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] 单服务已启动：http://0.0.0.0:${PORT}`);
  console.log(
    distReady
      ? `[server] 前端：${DIST_DIR}`
      : `[server] 未找到前端构建产物（${DIST_DIR}），仅提供 API，请先执行 npm run build`,
  );
  console.log(
    `[server] LLM: ${LLM_API_KEY && LLM_BASE_URL ? LLM_MODEL : "未配置（演示模式）"}`,
  );
});
