import * as XLSX from "xlsx";
import type { ApplicationRow, BatchItemResult, ScoreDimension, ScoreReport } from "@/types";
import { BUILT_IN_TOPICS, matchBuiltInTopic } from "@/config/topics";
import { TRACKS } from "@/config/tracks";
import { decisionLabel, decisionWeight } from "@/config/decisions";

export const TEMPLATE_HEADERS = [
  "应用名称（选填）",
  "赛道",
  "赛题",
  "COSMO Code应用链接",
  "OpenLab文章链接",
  "开源代码仓",
] as const;

const EXAMPLE_ROW: ApplicationRow = {
  name: "示例应用",
  track: TRACKS[0],
  topic: BUILT_IN_TOPICS[0],
  cosmocodeUrl: "https://example.com/app",
  openlabUrl: "https://example.com/article",
  repoUrl: "https://example.com/repo",
};

export function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([[...TEMPLATE_HEADERS]]);
  ws["!cols"] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 34 },
    { wch: 42 },
    { wch: 42 },
    { wch: 42 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "待评分应用");

  const exampleSheet = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    [
      EXAMPLE_ROW.name,
      EXAMPLE_ROW.track,
      EXAMPLE_ROW.topic,
      EXAMPLE_ROW.cosmocodeUrl,
      EXAMPLE_ROW.openlabUrl,
      EXAMPLE_ROW.repoUrl,
    ],
  ]);
  exampleSheet["!cols"] = ws["!cols"];
  XLSX.utils.book_append_sheet(wb, exampleSheet, "填写示例");

  const optionSheet = XLSX.utils.aoa_to_sheet([
    ["赛道（二选一）", "赛题（8 选一）", "定向揭榜赛题"],
    ...Array.from(
      { length: Math.max(TRACKS.length, BUILT_IN_TOPICS.length) },
      (_, i) => [
        TRACKS[i] ?? "",
        BUILT_IN_TOPICS[i] ?? "",
        i < 3 ? "是（+10分）" : "",
      ],
    ),
  ]);
  optionSheet["!cols"] = [{ wch: 16 }, { wch: 40 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, optionSheet, "赛道与赛题选项");

  XLSX.writeFile(wb, "待评分应用模板.xlsx");
}

function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

export async function parseApplicationsFile(file: File): Promise<ApplicationRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("表格中未找到工作表");

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  const rows: ApplicationRow[] = [];
  for (const raw of rawRows) {
    const track = pick(raw, ["赛道"]);
    const rawTopic = pick(raw, ["赛题", "题目", "topic"]);
    const topic = rawTopic ? matchBuiltInTopic(rawTopic) || rawTopic : "";
    const cosmocodeUrl = pick(raw, [
      "COSMO Code应用链接",
      "COSMO Code链接",
      "COSMO应用链接",
      "应用链接",
      "cosmocode",
    ]);
    const openlabUrl = pick(raw, ["OpenLab文章链接", "OpenLab链接", "文章链接", "openlab"]);
    const repoUrl = pick(raw, ["开源代码仓", "代码仓", "代码仓库", "仓库", "repo", "git"]);
    const name = pick(raw, ["应用名称（选填）", "应用名称", "应用名", "名称", "name"]);

    if (name === "示例应用") continue;

    const hasAnyLink = cosmocodeUrl || openlabUrl || repoUrl;
    if (!hasAnyLink) continue;

    rows.push({
      name,
      track,
      topic,
      cosmocodeUrl,
      openlabUrl,
      repoUrl,
    });
  }

  if (rows.length === 0) {
    throw new Error("未解析到有效数据，请确认表头包含「赛道」「赛题」及至少一个链接列");
  }
  return rows;
}

export function exportResultsCsv(
  items: BatchItemResult[],
  dimensions: ScoreDimension[],
  filename = "预审打分结果.csv",
) {
  const csv = buildResultsCsv(items, dimensions);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename);
}

export function exportSingleResultCsv(
  meta: {
    name: string;
    track: string;
    topic: string;
    cosmocodeUrl: string;
    openlabUrl: string;
    repoUrl: string;
  },
  report: ScoreReport,
  dimensions: ScoreDimension[],
) {
  const item: BatchItemResult = {
    ...meta,
    status: "done",
    report,
  };
  const csv = buildResultsCsv([item], dimensions);
  const safeName = (meta.name || "评分结果").replace(/[\\/:*?"<>|]/g, "_");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${safeName}_预审打分结果.csv`);
}

function buildResultRows(
  items: BatchItemResult[],
  dimensions: ScoreDimension[],
): { header: string[]; rows: string[][] } {
  const header = [
    "应用名称",
    "赛道",
    "赛题",
    "COSMO Code应用链接",
    "OpenLab文章链接",
    "开源代码仓",
    ...dimensions.map((d) => `${d.name}(${d.weight}%)`),
    "五维加权分",
    "开源加分",
    "定向赛题加分",
    "综合总分",
    ...dimensions.map((d) => `${d.name}评分依据`),
    "开源加分依据",
    "定向加分依据",
    "综合评价",
    "状态",
    "备注",
  ];

  const rows = items.map((item, index) => {
    const row = index + 2;
    const scoreByKey = new Map(
      (item.report?.dimensions ?? []).map((d) => [d.key, d.score]),
    );
    const reasonByKey = new Map(
      (item.report?.dimensions ?? []).map((d) => [d.key, d.reason]),
    );
    const dimensionCells = dimensions.map((d) => {
      const score = scoreByKey.get(d.key);
      return score === undefined || score === null ? "" : String(score);
    });
    const dimensionReasons = dimensions.map((d) => reasonByKey.get(d.key) ?? "");
    const openSourceReason = item.report?.openSourceReason ?? "";
    const directedReason = item.report
      ? item.report.directedTopicBonus > 0
        ? `属于定向揭榜赛题，加 ${item.report.directedTopicBonus} 分`
        : "非定向揭榜赛题，不加定向分"
      : "";
    const overall = item.report?.summary ?? "";

    const dimStartCol = 6;
    const fiveDimColLetter = colLetter(dimStartCol + dimensions.length);
    const openSourceColLetter = colLetter(dimStartCol + dimensions.length + 1);
    const directedColLetter = colLetter(dimStartCol + dimensions.length + 2);
    const totalWeight =
      dimensions.reduce((sum, d) => sum + (Number(d.weight) || 0), 0) || 1;
    const terms = dimensions
      .map(
        (d, k) => `${colLetter(dimStartCol + k)}${row}*${Number(d.weight) || 0}`,
      )
      .join("+");
    const fiveDimCell =
      item.report && dimensions.length
        ? `=ROUND((${terms})/${totalWeight},0)`
        : item.report
          ? String(Math.round(item.report.fiveDimScore))
          : "";
    const totalCell = item.report
      ? `=${fiveDimColLetter}${row}+${openSourceColLetter}${row}+${directedColLetter}${row}`
      : "";

    return [
      item.name,
      item.track,
      item.topic,
      item.cosmocodeUrl,
      item.openlabUrl,
      item.repoUrl,
      ...dimensionCells,
      fiveDimCell,
      item.report ? String(item.report.openSourceBonus) : "",
      item.report ? String(item.report.directedTopicBonus) : "",
      totalCell,
      ...dimensionReasons,
      openSourceReason,
      directedReason,
      overall,
      statusLabel(item.status),
      item.error ?? "",
    ];
  });

  return { header, rows };
}

function buildResultsCsv(
  items: BatchItemResult[],
  dimensions: ScoreDimension[],
): string {
  const { header, rows } = buildResultRows(items, dimensions);
  return [header, ...rows]
    .map((cells) => cells.map(escapeCsv).join(","))
    .join("\r\n");
}

export function exportTrackedXlsx(
  items: BatchItemResult[],
  dimensions: ScoreDimension[],
  filename = "赛道排序结果.xlsx",
) {
  const groups = new Map<string, BatchItemResult[]>();
  for (const item of items) {
    const key = (item.track || "").trim() || "未填写赛道";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const fiveDimIndex = 6 + dimensions.length;
  const totalIndex = fiveDimIndex + 3;

  for (const [track, group] of groups) {
    const sorted = [...group].sort((a, b) => {
      const dw = decisionWeight(a.decision) - decisionWeight(b.decision);
      if (dw !== 0) return dw;
      return (b.report?.total ?? -1) - (a.report?.total ?? -1);
    });
    const { header, rows } = buildResultRows(sorted, dimensions);
    const sheetRows = [header.concat("评审结果")].concat(
      rows.map((row, i) => row.concat(decisionLabel(sorted[i].decision))),
    );
    const sheet = XLSX.utils.aoa_to_sheet(sheetRows);

    const fiveCol = colLetter(fiveDimIndex);
    const totalCol = colLetter(totalIndex);
    for (let i = 0; i < sorted.length; i += 1) {
      const excelRow = i + 2;
      const report = sorted[i].report;
      const cached: Record<string, number> = {
        [fiveCol]: Math.round(report?.fiveDimScore ?? 0),
        [totalCol]: Math.round(report?.total ?? 0),
      };
      for (const col of [fiveCol, totalCol]) {
        const addr = `${col}${excelRow}`;
        const cell = sheet[addr];
        if (cell && typeof cell.v === "string" && cell.v.startsWith("=")) {
          sheet[addr] = { t: "n", f: cell.v.slice(1), v: cached[col] };
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, sheet, uniqueSheetName(track, usedNames));
  }

  XLSX.writeFile(workbook, filename);
}

function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = (raw.replace(/[\\/:*?\[\]<>]/g, "_").trim() || "赛道").slice(0, 28);
  let name = base;
  let i = 2;
  while (used.has(name)) {
    name = `${base}_${i}`;
    i += 1;
  }
  used.add(name);
  return name;
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function statusLabel(status: BatchItemResult["status"]): string {
  switch (status) {
    case "done":
      return "已完成";
    case "error":
      return "失败";
    case "scoring":
      return "评审中";
    default:
      return "待评审";
  }
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
