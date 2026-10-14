import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enrichRepo, probeRepoAccess } from "./repo.js";
import { renderPage } from "./browser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

const PORT = Number(process.env.PORT || 3001);
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "").replace(/\/+$/, "");
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";

const DIRECTED_TOPICS = [
  "基于多智能应用协同的高效换产",
  "空压站多机协同智能调度智能应用",
  "离散制造·结构件「智图智构」",
];
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

async function writeHistory(list) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(list, null, 2), "utf8");
}

app.get("/api/history", async (_req, res) => {
  const items = await readHistory();
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

app.post("/api/check-repos", async (req, res) => {
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
        results[url] = await probeRepoAccess(url);
      } catch {
        results[url] = { accessible: false, private: true, status: 0, note: "探测失败" };
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

function buildMessages({ track, topic, links, dimensions, pages }) {
  const dimLines = dimensions
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

  const system =
    "你是一位严谨的智能应用评审专家。请根据赛道、赛题要求及申报材料对参赛系统进行预审打分。" +
    "评审必须基于下方逐条列出的抓取内容；若某来源缺失或无法解析，应在相应维度的评分理由中说明依据不足。" +
    "每个维度满分100分，取0-100的整数。必须严格输出 JSON，不要输出任何多余文字。";

  const user =
    `【申报信息】\n${linkLines}\n\n` +
    `【逐条抓取内容（共 ${pages.filter((p) => p.ok).length}/${pages.filter((p) => p.url).length} 条成功）】\n${evidence}\n\n` +
    `【评分维度】\n${dimLines}\n\n` +
    `请输出 JSON，格式为：` +
    `{"summary":"总体评语，120字以内","repoConsistent":布尔值,"repoConsistentReason":"仅当填写了开源代码仓时，判断仓库中的代码是否与参赛作品一致，50字以内；未填写则填 false 和空字符串","dimensions":[{"key":"维度key","name":"维度名称","score":整数,"reason":"评分理由，80字以内，需引用具体来源"}]}。` +
    `dimensions 必须包含且仅包含上述维度，key 必须与给定一致。` +
    `判定 repoConsistent 时必须对比「开源代码仓」抓取内容与作品介绍，只有代码确与参赛作品一致才为 true。`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function buildCalibrateMessages(dimensions, items) {
  const dimLines = dimensions
    .map((d, i) => `${i + 1}. ${d.name}（key=${d.key}，权重${d.weight}%）：${d.description || ""}`)
    .join("\n");
  const itemLines = items
    .map((it) => {
      const idx = Number(it.index);
      const scores = (Array.isArray(it.dimensions) ? it.dimensions : [])
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
    `必须包含全部应用与全部维度，key 与给定一致。`;

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

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 60;
  return Math.max(0, Math.min(100, Math.round(n)));
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
  if (!/\.code\.cosmoplat\.cn$/.test(url.hostname.toLowerCase())) {
    return {
      status: "error",
      message: "应形如 https://<端口>-<hash>.code.cosmoplat.cn",
    };
  }
  return { status: "ok", message: "格式正确" };
}

function zeroReport(dimensions, model, links, message) {
  const normalized = dimensions.map((d) => ({
    key: d.key,
    name: d.name,
    weight: Number(d.weight) || 0,
    score: 0,
    reason: message,
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

function bonusBreakdown(fiveDimScore, repoUrl, repoConsistent, topic) {
  const hasRepo = Boolean((repoUrl || "").trim());
  const openSourceBonus = hasRepo && repoConsistent ? OPEN_SOURCE_BONUS : 0;
  const directedTopicBonus = DIRECTED_TOPICS.includes(String(topic || "").trim())
    ? DIRECTED_TOPIC_BONUS
    : 0;
  return {
    fiveDimScore,
    openSourceBonus,
    directedTopicBonus,
    total: fiveDimScore + openSourceBonus + directedTopicBonus,
  };
}

function normalize(parsed, dimensions, mode, model, sources = [], context = {}) {
  const byKey = new Map();
  const list = Array.isArray(parsed?.dimensions) ? parsed.dimensions : [];
  for (const item of list) {
    if (item && typeof item.key === "string") byKey.set(item.key, item);
  }

  const normalized = dimensions.map((d) => {
    const raw = byKey.get(d.key);
    return {
      key: d.key,
      name: d.name,
      weight: Number(d.weight) || 0,
      score: clampScore(raw?.score),
      reason:
        (raw && typeof raw.reason === "string" && raw.reason.trim()) ||
        "暂无评分说明。",
    };
  });

  const fiveDimScore = weightedTotal(normalized);
  const bonus = bonusBreakdown(
    fiveDimScore,
    context.repoUrl,
    parsed?.repoConsistent === true,
    context.topic,
  );

  return {
    ...bonus,
    openSourceReason:
      (parsed && typeof parsed.repoConsistentReason === "string" && parsed.repoConsistentReason.trim()) ||
      "",
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
    score: 60 + ((base >> (i * 3)) % 36),
    reason: `（演示数据）依据赛道、赛题与申报材料，${d.name}维度表现处于中等偏上水平。配置大模型后可获得真实评审意见。`,
  }));
  const fiveDimScore = weightedTotal(normalized);
  const bonus = bonusBreakdown(fiveDimScore, context.repoUrl, true, context.topic);
  return {
    ...bonus,
    openSourceReason: bonus.openSourceBonus
      ? "（演示数据）已填写开源代码仓，默认视为与参赛作品一致。"
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
      return res.json(mockReport(dimensions, seed, mockSources, { topic, repoUrl: links.repoUrl }));
    }

    const pages = await collectAllPages(links);
    const sources = toSources(pages);

    const messages = buildMessages({
      track: String(track || "").trim(),
      topic: topic.trim(),
      links,
      dimensions,
      pages,
    });

    const content = await callLLM(messages);
    const parsed = extractJson(content);
    return res.json(normalize(parsed, dimensions, "llm", LLM_MODEL, sources, { topic, repoUrl: links.repoUrl }));
  } catch (err) {
    return res.status(500).json({
      error: `评分失败：${err instanceof Error ? err.message : String(err)}`,
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] scoring API listening on http://0.0.0.0:${PORT}`);
  console.log(
    `[server] LLM: ${LLM_API_KEY && LLM_BASE_URL ? LLM_MODEL : "未配置（演示模式）"}`,
  );
});
