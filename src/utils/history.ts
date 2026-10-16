import type { BatchItemResult, HistoryEntry, ReviewDecision } from "@/types";

export function newHistoryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function fetchHistory(): Promise<HistoryEntry[]> {
  const res = await fetch("/api/history");
  if (!res.ok) throw new Error(`读取历史失败（HTTP ${res.status}）`);
  const data = (await res.json()) as { items?: HistoryEntry[] };
  return Array.isArray(data.items) ? data.items : [];
}

export async function saveHistory(entry: HistoryEntry): Promise<void> {
  const res = await fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`保存历史失败（HTTP ${res.status}）`);
}

export async function deleteHistory(id: string): Promise<void> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`删除历史失败（HTTP ${res.status}）`);
}

export async function patchHistoryDecision(
  id: string,
  itemId: string,
  decision: ReviewDecision | null,
): Promise<void> {
  const res = await fetch(
    `/api/history/${encodeURIComponent(id)}/decision`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, decision }),
    },
  );
  if (!res.ok) throw new Error(`更新评审状态失败（HTTP ${res.status}）`);
}

export async function patchHistoryEntry(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`更新历史记录失败（HTTP ${res.status}）`);
}

export async function patchHistoryItem(
  id: string,
  itemId: string,
  patch: Partial<BatchItemResult>,
): Promise<void> {
  const res = await fetch(
    `/api/history/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) throw new Error(`更新应用数据失败（HTTP ${res.status}）`);
}
