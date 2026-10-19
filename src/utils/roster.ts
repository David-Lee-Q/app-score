import * as XLSX from "xlsx";
import { normalizeMatchKey } from "./usage";

export const ROSTER_TEMPLATE_HEADERS = [
  "COSMO Code应用链接",
  "作品ID",
  "姓名",
  "手机号",
] as const;

export function downloadRosterTemplate() {
  const header = [...ROSTER_TEMPLATE_HEADERS];
  const ws = XLSX.utils.aoa_to_sheet([
    header,
    ["https://8080-abc12345.code.cosmoplat.cn", "A1001", "张三", "13800000000"],
  ]);
  ws["!cols"] = [{ wch: 46 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "作品信息");
  XLSX.writeFile(wb, "补作品信息模板.xlsx");
}

export interface RosterRow {
  rawKey: string;
  key: string;
  workId: string;
  personName: string;
  phone: string;
}

const LINK_KEYS = [
  "COSMO Code应用链接",
  "COSMO Code链接",
  "COSMO应用链接",
  "应用链接",
  "预览地址",
  "cosmocode",
];

const WORK_ID_KEYS = ["作品ID", "作品id", "作品 ID", "作品编号", "workId", "workid"];
const NAME_KEYS = ["姓名", "联系人", "负责人", "personName", "owner"];
const PHONE_KEYS = ["手机号", "手机号码", "联系电话", "联系方式", "phone", "mobile"];

function findCol(header: string[], keys: string[]): number {
  const lower = keys.map((k) => k.toLowerCase());
  return header.findIndex((cell) => lower.includes(cell.trim().toLowerCase()));
}

function cell(row: unknown[], index: number): string {
  if (index < 0) return "";
  const value = row[index];
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export async function parseRosterFile(file: File): Promise<RosterRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("表格中未找到工作表");

  const sheet = workbook.Sheets[firstSheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  let headerIndex = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const row = (raw[i] ?? []).map((c) => String(c ?? "").trim());
    if (findCol(row, LINK_KEYS) !== -1) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new Error("未找到「COSMO Code应用链接」列，请确认表头是否包含该列");
  }

  const header = (raw[headerIndex] ?? []).map((c) => String(c ?? "").trim());
  const linkCol = findCol(header, LINK_KEYS);
  const workIdCol = findCol(header, WORK_ID_KEYS);
  const nameCol = findCol(header, NAME_KEYS);
  const phoneCol = findCol(header, PHONE_KEYS);

  const rows: RosterRow[] = [];
  for (let i = headerIndex + 1; i < raw.length; i += 1) {
    const row = raw[i] ?? [];
    const rawKey = cell(row, linkCol);
    if (!rawKey) continue;
    rows.push({
      rawKey,
      key: normalizeMatchKey(rawKey),
      workId: cell(row, workIdCol),
      personName: cell(row, nameCol),
      phone: cell(row, phoneCol),
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "未解析到有效数据，请确认表头包含「COSMO Code应用链接」及「作品ID」「姓名」「手机号」",
    );
  }
  return rows;
}
