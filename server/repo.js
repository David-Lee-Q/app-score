import { renderPage } from "./browser.js";

const GITLAB_TOKEN = process.env.GITLAB_TOKEN || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITLAB_HOSTS = (process.env.GITLAB_HOSTS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

async function fetchJson(url, headers = {}, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 PreReviewBot/1.0", ...headers },
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, status: resp.status, text };
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: true, raw: text };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function safeUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export async function enrichRepo(url) {
  const parsed = safeUrl(url);
  if (!parsed) return { ok: false, note: "链接格式无效" };
  const host = parsed.hostname.toLowerCase();

  if (host === "github.com" || host === "www.github.com") {
    return enrichGitHub(parsed);
  }

  if (host.includes("gitlab") || host.includes("gitcode")) {
    const api = await enrichGitLab(parsed, host);
    if (api.ok) return api;
    return enrichByFallback(parsed, url, api.note);
  }

  return enrichByFallback(parsed, url, "");
}

async function enrichByFallback(parsed, url, apiNote) {
  const [rendered, readme] = await Promise.all([
    renderRepoPage(url),
    fetchRawReadme(parsed, ["main", "master"]),
  ]);
  const parts = [];
  if (rendered.ok) parts.push(rendered.text);
  if (readme) {
    parts.push(`【README 节选（原始文件）】\n${readme.replace(/\s+/g, " ").slice(0, 4000)}`);
  }
  if (parts.length) {
    const note = apiNote
      ? `${apiNote}；已补充仓库页面与 README 原始内容`
      : "已通过无头浏览器解析仓库页面并获取 README";
    return { ok: true, text: parts.join("\n\n"), note };
  }
  return { ok: false, note: apiNote || "无法访问代码仓（可能为私有仓库）" };
}

async function fetchRawReadme(parsed, branches) {
  const base = `${parsed.origin}${parsed.pathname.replace(/\.git$/, "").replace(/\/+$/, "")}`;
  const names = ["README.md", "readme.md", "Readme.md", "README.MD"];
  for (const br of branches) {
    for (const name of names) {
      const r = await fetchJson(`${base}/raw/${encodeURIComponent(br)}/${name}`, {}, 12000);
      if (r.ok && typeof r.raw === "string" && r.raw.trim().length > 20) {
        return r.raw;
      }
    }
  }
  return "";
}

async function fetchText(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 PreReviewBot/1.0" },
    });
    const location = resp.headers.get("location") || "";
    let text = "";
    if (resp.ok) text = await resp.text();
    return { status: resp.status, ok: resp.ok, location, text };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

const LOGIN_HINT = /sign[_-]?in|login|请先登录/i;

export async function probeRepoAccess(url) {
  const parsed = safeUrl(url);
  if (!parsed) {
    return { accessible: false, private: true, status: 0, note: "链接格式无效" };
  }
  const host = parsed.hostname.toLowerCase();

  if (host === "github.com" || host === "www.github.com") {
    const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length < 2) {
      return { accessible: false, private: true, status: 0, note: "无法解析仓库路径" };
    }
    const headers = { Accept: "application/vnd.github+json" };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    const r = await fetchJson(`https://api.github.com/repos/${parts[0]}/${parts[1]}`, headers, 15000);
    if (r.status === 404) return { accessible: false, private: true, status: 404, note: "不存在或私有" };
    if (r.ok) return { accessible: true, private: false, status: 200, note: "公开可访问" };
    if (r.status === 401 || r.status === 403) {
      return { accessible: false, private: true, status: r.status, note: "私有或需登录" };
    }
    return { accessible: false, private: true, status: r.status || 0, note: "无法访问（可能私有或网络受限）" };
  }

  const res = await fetchText(url, 15000);
  if (res.status >= 300 && res.status < 400) {
    if (LOGIN_HINT.test(res.location)) {
      return { accessible: false, private: true, status: res.status, note: "跳转登录页，私有仓库" };
    }
    return { accessible: false, private: true, status: res.status, note: `重定向（HTTP ${res.status}）` };
  }
  if (res.ok) {
    const t = (res.text || "").toLowerCase();
    if (t.includes("sign in to continue") || t.includes("请先登录")) {
      return { accessible: false, private: true, status: res.status, note: "需登录访问，私有仓库" };
    }
    return { accessible: true, private: false, status: res.status, note: "公开可访问" };
  }
  if (res.status === 401 || res.status === 403) {
    return { accessible: false, private: true, status: res.status, note: "私有或需登录" };
  }
  if (res.status === 404) {
    return { accessible: false, private: true, status: 404, note: "不存在或私有" };
  }
  return { accessible: false, private: true, status: res.status || 0, note: "无法访问（可能私有或网络受限）" };
}

async function renderRepoPage(url) {
  const r = await renderPage(url);
  if (!r.ok) return { ok: false, note: r.note };
  return { ok: true, text: `【代码仓页面（无头浏览器解析）】\n${r.text}` };
}

async function enrichGitHub(parsed) {
  const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return { ok: false, note: "无法解析 GitHub 仓库路径" };
  const [owner, repo] = parts;
  const headers = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const lines = [`【代码仓信息】平台：GitHub；${owner}/${repo}`];
  let got = false;

  const meta = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`, headers);
  if (meta.ok && meta.data) {
    got = true;
    lines.push(`- 描述：${meta.data.description || "无"}`);
    lines.push(`- 主要语言：${meta.data.language || "未知"}`);
    lines.push(`- 规模：${meta.data.size} KB；Star ${meta.data.stars ?? meta.data.stargazers_count ?? 0}`);
    if (meta.data.pushed_at) lines.push(`- 最近更新：${meta.data.pushed_at}`);
  } else if (meta.status === 404) {
    return { ok: false, note: "仓库不存在或无权限访问（HTTP 404）" };
  }

  const langs = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/languages`, headers);
  if (langs.ok && langs.data && Object.keys(langs.data).length) {
    got = true;
    const top = Object.entries(langs.data).slice(0, 6).map(([k, v]) => `${k}(${v}B)`).join("、");
    lines.push(`- 语言分布：${top}`);
  }

  const commits = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=5`, headers);
  if (commits.ok && Array.isArray(commits.data) && commits.data.length) {
    got = true;
    lines.push(`- 最近提交（${commits.data.length} 条）：`);
    for (const c of commits.data) {
      lines.push(`  · ${(c.commit?.message || "").split("\n")[0]}`);
    }
  }

  const readme = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/readme`, {
    ...headers,
    Accept: "application/vnd.github.raw",
  });
  let readmeText = "";
  if (readme.ok && readme.raw) {
    got = true;
    readmeText = readme.raw.replace(/\s+/g, " ").slice(0, 4000);
  }

  if (!got) return { ok: false, note: "未能获取仓库信息（可能是私有仓库，未配置令牌）" };
  return { ok: true, text: lines.join("\n") + (readmeText ? `\n\n【README 节选】\n${readmeText}` : "") };
}

async function enrichGitLab(parsed, host) {
  const projectPath = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (!projectPath || !projectPath.includes("/")) {
    return { ok: false, note: "无法解析 GitLab 项目路径" };
  }

  const headers = {};
  let authed = false;
  if (GITLAB_TOKEN && GITLAB_HOSTS.includes(host)) {
    headers["PRIVATE-TOKEN"] = GITLAB_TOKEN;
    authed = true;
  }

  const api = `https://${host}/api/v4/projects/${encodeURIComponent(projectPath)}`;
  const lines = [`【代码仓信息】平台：GitLab；项目：${projectPath}${authed ? "（已鉴权）" : "（未鉴权）"}`];
  let got = false;

  const meta = await fetchJson(api, headers);
  if (meta.status === 401 || meta.status === 403) {
    return { ok: false, note: `GitLab 鉴权失败（HTTP ${meta.status}），请配置该主机的令牌` };
  }
  if (meta.status === 404) {
    return { ok: false, note: "项目不存在或无权限访问（HTTP 404）" };
  }
  if (meta.ok && meta.data) {
    got = true;
    lines.push(`- 描述：${meta.data.description || "无"}`);
    lines.push(`- 默认分支：${meta.data.default_branch || "未知"}`);
    if (meta.data.last_activity_at) lines.push(`- 最近活动：${meta.data.last_activity_at}`);
    if (meta.data.star_count !== undefined) lines.push(`- Star：${meta.data.star_count}`);
  }

  const tree = await fetchJson(`${api}/repository/tree?recursive=true&per_page=100`, headers);
  if (tree.ok && Array.isArray(tree.data) && tree.data.length) {
    got = true;
    const files = tree.data.filter((n) => n.type === "blob").map((n) => n.path);
    lines.push(`- 仓库文件（共 ${files.length} 项，节选）：`);
    lines.push(`  ${files.slice(0, 40).join("、")}`);
  }

  const commits = await fetchJson(`${api}/repository/commits?per_page=5`, headers);
  if (commits.ok && Array.isArray(commits.data) && commits.data.length) {
    got = true;
    lines.push(`- 最近提交（${commits.data.length} 条）：`);
    for (const c of commits.data) {
      lines.push(`  · ${(c.title || "").split("\n")[0]} — ${c.author_name || ""}`);
    }
  }

  const readme = await fetchJson(`${api}/repository/files/${encodeURIComponent("README.md")}/raw?ref=${encodeURIComponent(meta.data?.default_branch || "main")}`, headers);
  let readmeText = "";
  if (readme.ok && readme.raw) {
    got = true;
    readmeText = readme.raw.replace(/\s+/g, " ").slice(0, 4000);
  }

  if (!got) return { ok: false, note: "未能获取项目信息" };
  return { ok: true, text: lines.join("\n") + (readmeText ? `\n\n【README 节选】\n${readmeText}` : "") };
}
