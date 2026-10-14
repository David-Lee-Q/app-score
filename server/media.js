import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { extractMediaUrl } from "./browser.js";

const LLM_BASE_URL = (process.env.LLM_BASE_URL || "").replace(/\/+$/, "");
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const ASR_MODEL = process.env.ASR_MODEL || "cosmo-mind-asr";
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
const MAX_MEDIA_BYTES = 60 * 1024 * 1024;

function guessExt(url, contentType) {
  const match = url.split("?")[0].match(/\.([a-z0-9]{2,4})$/i);
  if (match) return match[1].toLowerCase();
  const map = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
  };
  return map[(contentType || "").toLowerCase().split(";")[0]] || "bin";
}

function extractMediaFromHtml(html) {
  const patterns = [
    /<meta[^>]+property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video/i,
    /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/i,
    /<video[^>]*\ssrc=["']([^"']+)["']/i,
    /<source[^>]*\ssrc=["']([^"']+)["']/i,
    /"playAddr"\s*:\s*"([^"]+)"/i,
    /"play_addr"\s*:\s*\{[^}]*"url_list"\s*:\s*\[\s*"([^"]+)"/i,
    /"backup_url"\s*:\s*\[\s*"([^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      return m[1]
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/")
        .replace(/\\u0026/gi, "&")
        .replace(/\\u003D/gi, "=");
    }
  }
  return "";
}

async function downloadMedia(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const headers = { "User-Agent": "Mozilla/5.0 PreReviewBot/1.0" };
    if (referer) headers.Referer = referer;
    const resp = await fetch(url, { signal: controller.signal, redirect: "follow", headers });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const contentType = resp.headers.get("content-type") || "";
    const length = Number(resp.headers.get("content-length") || 0);
    if (length && length > MAX_MEDIA_BYTES) {
      return { ok: false, error: `文件过大（${Math.round(length / 1048576)}MB）` };
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length > MAX_MEDIA_BYTES) return { ok: false, error: "文件过大" };
    return { ok: true, buffer, contentType };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.split("\n").filter(Boolean).slice(-2).join(" ").trim() || `ffmpeg exit ${code}`));
    });
  });
}

async function transcribeBuffer(buffer, filename, mime) {
  const form = new FormData();
  form.append("model", ASR_MODEL);
  form.append("file", new Blob([buffer], { type: mime }), filename);
  const resp = await fetch(`${LLM_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LLM_API_KEY}` },
    body: form,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`ASR ${resp.status}: ${body.slice(0, 120)}`);
  }
  const data = await resp.json();
  return (data.text || "").trim();
}

export async function transcribeMedia(url, opts = {}) {
  const depth = opts.depth || 0;
  if (!LLM_API_KEY || !LLM_BASE_URL) return { ok: false, note: "未配置大模型接口" };
  if (depth > 2) return { ok: false, note: "媒体地址跳转层级过深，已停止" };

  const media = await downloadMedia(url, opts.referer);
  if (!media.ok) return { ok: false, note: `下载失败：${media.error}` };

  const contentType = (media.contentType || "").toLowerCase();
  const looksHtml = contentType.includes("text/html") || /^\s*<(!doctype|html)/i.test(media.buffer.subarray(0, 64).toString("utf8"));

  if (looksHtml) {
    const html = media.buffer.toString("utf8");
    let mediaUrl = extractMediaFromHtml(html);
    if (!mediaUrl) mediaUrl = await extractMediaUrl(url);
    if (!mediaUrl) {
      return { ok: false, note: "视频为网页分享链接，未能提取到媒体流（可能需登录或存在反爬限制）" };
    }
    const nested = await transcribeMedia(mediaUrl, { depth: depth + 1, referer: url });
    if (nested.ok) return { ok: true, text: nested.text, note: "已从分享页面提取媒体并转写" };
    return nested;
  }

  const isAudio = contentType.startsWith("audio/");
  const ext = guessExt(url, media.contentType);
  const workDir = path.join(tmpdir(), `asr_${randomUUID()}`);

  try {
    let audioBuffer = media.buffer;
    let audioMime = media.contentType || "audio/mpeg";
    let audioName = `input.${ext}`;

    if (!isAudio) {
      await fs.mkdir(workDir, { recursive: true });
      const inPath = path.join(workDir, `in.${ext}`);
      const outPath = path.join(workDir, "out.wav");
      await fs.writeFile(inPath, media.buffer);
      await runFfmpeg(["-y", "-i", inPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", outPath]);
      audioBuffer = await fs.readFile(outPath);
      audioMime = "audio/wav";
      audioName = "out.wav";
      if (audioBuffer.length <= 1024) {
        return { ok: false, note: "视频无有效音轨" };
      }
    }

    const text = await transcribeBuffer(audioBuffer, audioName, audioMime);
    if (!text) return { ok: false, note: "未识别到语音内容" };
    return { ok: true, text, note: "" };
  } catch (err) {
    return { ok: false, note: `转写失败：${err.message}` };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
