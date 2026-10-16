import * as XLSX from "xlsx";

export const USAGE_TEMPLATE_HEADERS = [
  "COSMO Code应用链接",
  "对话轮次",
  "活跃天数",
] as const;

const USAGE_EXAMPLE_ROW = [
  "https://8080-abc12345.code.cosmoplat.cn",
  "128",
  "15",
] as const;

export function downloadUsageTemplate() {
  const header = [...USAGE_TEMPLATE_HEADERS];
  const ws = XLSX.utils.aoa_to_sheet([header]);
  ws["!cols"] = [{ wch: 46 }, { wch: 14 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "补对话数据");

  const exampleSheet = XLSX.utils.aoa_to_sheet([
    header,
    [...USAGE_EXAMPLE_ROW],
  ]);
  exampleSheet["!cols"] = ws["!cols"];
  XLSX.utils.book_append_sheet(wb, exampleSheet, "填写示例");

  XLSX.writeFile(wb, "补对话模板.xlsx");
}

export interface UsageRow {
  rawKey: string;
  key: string;
  rounds: number | null;
  activeDays: number | null;
}

export interface UsageScoreInput {
  key: string;
  rounds: number;
  activeDays: number;
}

export function normalizeMatchKey(raw: string): string {
  const value = (raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${host}${path}`.toLowerCase();
  } catch {
    return value.replace(/\/+$/, "").toLowerCase();
  }
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

function toNumber(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function parseUsageFile(file: File): Promise<UsageRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("表格中未找到工作表");

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  const rows: UsageRow[] = [];
  for (const raw of rawRows) {
    const rawKey = pick(raw, [
      "COSMO Code应用链接",
      "COSMO Code链接",
      "COSMO应用链接",
      "应用链接",
      "预览地址",
      "cosmocode",
    ]);
    if (!rawKey) continue;
    const rounds = toNumber(pick(raw, ["对话轮次", "对话轮次（轮）", "轮次", "对话数"]));
    const activeDays = toNumber(pick(raw, ["活跃天数", "活跃天数（天）", "天数", "活跃天"]));
    rows.push({
      rawKey,
      key: normalizeMatchKey(rawKey),
      rounds,
      activeDays,
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "未解析到有效数据，请确认表头包含「COSMO Code应用链接」「对话轮次」「活跃天数」",
    );
  }
  return rows;
}

export function computeUsageScores(items: UsageScoreInput[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (items.length === 0) return scores;

  const roundsList = items.map((i) => i.rounds);
  const daysList = items.map((i) => i.activeDays);
  const rMin = Math.min(...roundsList);
  const rMax = Math.max(...roundsList);
  const dMin = Math.min(...daysList);
  const dMax = Math.max(...daysList);

  for (const item of items) {
    const rNorm =
      rMax === rMin ? 100 : ((item.rounds - rMin) / (rMax - rMin)) * 100;
    const dNorm =
      dMax === dMin ? 100 : ((item.activeDays - dMin) / (dMax - dMin)) * 100;
    const score = Math.round((rNorm + dNorm) / 2);
    scores.set(item.key, Math.max(0, Math.min(100, score)));
  }

  return scores;
}
