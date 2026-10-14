import * as XLSX from "xlsx";
import type { ApplicationRow, BatchItemResult, ScoreDimension, ScoreReport } from "@/types";
import { BUILT_IN_TOPICS, matchBuiltInTopic } from "@/config/topics";
import { TRACKS } from "@/config/tracks";

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

function buildResultsCsv(
  items: BatchItemResult[],
  dimensions: ScoreDimension[],
): string {
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
    "状态",
    "备注",
  ];

  const lines = items.map((item) => {
    const scoreByKey = new Map(
      (item.report?.dimensions ?? []).map((d) => [d.key, d.score]),
    );
    const dimensionCells = dimensions.map((d) => {
      const score = scoreByKey.get(d.key);
      return score === undefined ? "" : String(score);
    });
    const note = item.error ?? item.report?.summary ?? "";
    return [
      item.name,
      item.track,
      item.topic,
      item.cosmocodeUrl,
      item.openlabUrl,
      item.repoUrl,
      ...dimensionCells,
      item.report ? String(Math.round(item.report.fiveDimScore)) : "",
      item.report ? String(item.report.openSourceBonus) : "",
      item.report ? String(item.report.directedTopicBonus) : "",
      item.report ? String(Math.round(item.report.total)) : "",
      statusLabel(item.status),
      note,
    ];
  });

  const csv = [header, ...lines]
    .map((cells) => cells.map(escapeCsv).join(","))
    .join("\r\n");

  return csv;
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
