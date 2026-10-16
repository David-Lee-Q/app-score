import type { BatchItemResult, ReviewDecision } from "@/types";
import { APP_VERSION } from "@/config/changelog";
import { BUILT_IN_TOPICS } from "@/config/topics";
import { TRACKS } from "@/config/tracks";

export interface PosterOptions {
  fileName?: string;
  tracks?: string[];
}

interface RankRow {
  rank: number;
  name: string;
  track: string;
  topic: string;
  total: number;
  disqualified: boolean;
  decision?: ReviewDecision;
}

interface RankGroup {
  topic: string;
  rows: RankRow[];
}

const EVENT_TITLE = "卡奥斯第五届程序员节";
const COMPETITION_TITLE = "智能应用开发者大赛排行榜";
const EMPTY_TOPIC = "未填写赛题";

const W = 1080;
const PAD = 48;
const HEADER_H = 320;
const GROUP_H = 58;
const GROUP_TOP_GAP = 26;
const ROW_H = 96;
const ROW_GAP = 14;
const FOOTER_H = 110;
const DPR = 2;
const FONT = "'PingFang SC','Microsoft YaHei',system-ui,-apple-system,'Segoe UI',sans-serif";

const RANK_STYLE: Record<number, { bg: string; fg: string }> = {
  1: { bg: "#f59e0b", fg: "#ffffff" },
  2: { bg: "#94a3b8", fg: "#ffffff" },
  3: { bg: "#d97706", fg: "#ffffff" },
};
const DEFAULT_RANK = { bg: "#e2e8f0", fg: "#475569" };

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function ellipsis(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

function buildGroups(items: BatchItemResult[]): RankGroup[] {
  const scored = items.filter(
    (i) => i.report && typeof i.report.total === "number",
  );

  const map = new Map<string, RankRow[]>();
  for (const item of scored) {
    const topic = (item.topic || "").trim() || EMPTY_TOPIC;
    const row: RankRow = {
      rank: 0,
      name: (item.name || "未命名应用").trim(),
      track: (item.track || "").trim(),
      topic,
      total: Math.round(item.report!.total),
      disqualified: Boolean(item.report!.disqualified),
      decision: item.decision,
    };
    const list = map.get(topic);
    if (list) list.push(row);
    else map.set(topic, [row]);
  }

  const keys = [...map.keys()].sort((a, b) => {
    const ea = a === EMPTY_TOPIC;
    const eb = b === EMPTY_TOPIC;
    if (ea !== eb) return ea ? 1 : -1;
    const ia = BUILT_IN_TOPICS.indexOf(a);
    const ib = BUILT_IN_TOPICS.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return keys.map((topic) => {
    const rows = map
      .get(topic)!
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh"))
      .map((r, index) => ({ ...r, rank: index + 1 }));
    return { topic, rows };
  });
}

function resolveTracks(items: BatchItemResult[], override?: string[]): string[] {
  if (override && override.length) return override;
  const present = new Set(
    items.map((i) => (i.track || "").trim()).filter(Boolean),
  );
  const ordered = TRACKS.filter((t) => present.has(t));
  const unknown = [...present].filter((t) => !TRACKS.includes(t));
  return [...ordered, ...unknown];
}

export function generateRankingPoster(
  items: BatchItemResult[],
  options: PosterOptions = {},
) {
  const groups = buildGroups(items);
  const totalRows = groups.reduce((sum, g) => sum + g.rows.length, 0);
  if (totalRows === 0) {
    throw new Error("暂无可用于生成海报的评分结果");
  }

  const tracks = resolveTracks(items, options.tracks);

  let listH = 0;
  groups.forEach((g, gi) => {
    if (gi > 0) listH += GROUP_TOP_GAP;
    listH += GROUP_H;
    listH += g.rows.length * ROW_H + (g.rows.length - 1) * ROW_GAP;
  });
  const H = HEADER_H + 12 + listH + FOOTER_H;

  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持海报生成");
  ctx.scale(DPR, DPR);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#eef2ff");
  bg.addColorStop(0.45, "#f5f3ff");
  bg.addColorStop(1, "#f8fafc");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const hx = PAD;
  const hy = PAD;
  const hw = W - PAD * 2;
  const hh = HEADER_H - PAD * 1.5;
  const hg = ctx.createLinearGradient(hx, hy, hx + hw, hy + hh);
  hg.addColorStop(0, "#4f46e5");
  hg.addColorStop(1, "#7c3aed");
  roundRect(ctx, hx, hy, hw, hh, 28);
  ctx.fillStyle = hg;
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.arc(hx + hw - 60, hy + 34, 150, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + hw - 190, hy + hh - 6, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `600 32px ${FONT}`;
  ctx.fillText(ellipsis(ctx, EVENT_TITLE, hw - 96), hx + 48, hy + 62);

  ctx.fillStyle = "#ffffff";
  ctx.font = `800 50px ${FONT}`;
  ctx.fillText(ellipsis(ctx, COMPETITION_TITLE, hw - 96), hx + 48, hy + 128);

  if (tracks.length) {
    let tx = hx + 48;
    const pillH = 42;
    const pillCy = hy + 202;
    ctx.font = `600 22px ${FONT}`;
    for (const track of tracks) {
      const textW = ctx.measureText(track).width;
      const pillW = textW + 36;
      roundRect(ctx, tx, pillCy - pillH / 2, pillW, pillH, pillH / 2);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(track, tx + 18, pillCy + 8);
      tx += pillW + 12;
    }
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `400 20px ${FONT}`;
  const metaStr = `共 ${totalRows} 个应用 · 按赛题分组 · 生成于 ${new Date().toLocaleDateString("zh-CN")}`;
  ctx.fillText(ellipsis(ctx, metaStr, hw - 96 - 260), hx + hw - 48, hy + 210);
  ctx.textAlign = "left";

  const cardX = PAD;
  const cardW = W - PAD * 2;
  const badgeCx = cardX + 56;
  let y = HEADER_H + 12;

  groups.forEach((group, gi) => {
    if (gi > 0) y += GROUP_TOP_GAP;

    ctx.fillStyle = "#4338ca";
    roundRect(ctx, cardX + 4, y + 14, 6, 28, 3);
    ctx.fill();
    ctx.fillStyle = "#1e293b";
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(ellipsis(ctx, group.topic, cardW - 220), cardX + 22, y + 38);
    ctx.textAlign = "right";
    ctx.fillStyle = "#6366f1";
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(`${group.rows.length} 个应用`, cardX + cardW - 6, y + 36);
    ctx.textAlign = "left";
    y += GROUP_H;

    group.rows.forEach((row) => {
      roundRect(ctx, cardX, y, cardW, ROW_H, 20);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      if (row.rank <= 3) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = RANK_STYLE[row.rank].bg;
        ctx.stroke();
      }

      const midY = y + ROW_H / 2;

      const style = RANK_STYLE[row.rank] || DEFAULT_RANK;
      ctx.beginPath();
      ctx.arc(badgeCx, midY, 28, 0, Math.PI * 2);
      ctx.fillStyle = style.bg;
      ctx.fill();
      ctx.fillStyle = style.fg;
      ctx.font = `700 28px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(String(row.rank), badgeCx, midY + 10);
      ctx.textAlign = "left";

      const textX = cardX + 108;
      const textMax = cardW - 108 - 220;

      const advance = row.decision === "advance";
      ctx.font = `600 18px ${FONT}`;
      const tagTextW = advance ? ctx.measureText("晋级").width : 0;
      const tagW = advance ? tagTextW + 26 : 0;
      const nameMax = textMax - (advance ? tagW + 12 : 0);

      ctx.fillStyle = "#1e293b";
      ctx.font = `700 30px ${FONT}`;
      const nameText = ellipsis(ctx, row.name, nameMax);
      ctx.fillText(nameText, textX, midY + 10);

      if (advance) {
        const nameW = ctx.measureText(nameText).width;
        const pillX = textX + nameW + 12;
        const pillH = 34;
        roundRect(ctx, pillX, midY - pillH / 2, tagW, pillH, pillH / 2);
        ctx.fillStyle = "#dcfce7";
        ctx.fill();
        ctx.strokeStyle = "#86efac";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#15803d";
        ctx.font = `600 18px ${FONT}`;
        ctx.fillText("晋级", pillX + 13, midY + 6);
      }

      const scoreColor = row.disqualified ? "#e11d48" : "#4338ca";
      ctx.textAlign = "right";
      ctx.fillStyle = scoreColor;
      ctx.font = `800 42px ${FONT}`;
      ctx.fillText(String(row.total), cardX + cardW - 44, midY + 12);
      if (row.disqualified) {
        ctx.fillStyle = "#fb7185";
        ctx.font = `500 18px ${FONT}`;
        ctx.fillText("链接无效", cardX + cardW - 44, midY - 26);
      }
      ctx.textAlign = "left";

      y += ROW_H + ROW_GAP;
    });
  });

  ctx.fillStyle = "#94a3b8";
  ctx.font = `400 20px ${FONT}`;
  ctx.textAlign = "center";
  const dateStr = new Date().toLocaleString("zh-CN");
  ctx.fillText(
    `智能应用预审打分系统 · ${APP_VERSION} · 生成于 ${dateStr}`,
    W / 2,
    H - FOOTER_H / 2,
  );
  ctx.textAlign = "left";

  const fileName =
    options.fileName || `排行榜_${new Date().toISOString().slice(0, 10)}.png`;

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
