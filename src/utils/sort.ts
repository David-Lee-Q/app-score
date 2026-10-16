export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

export function toggleSort(
  current: SortState | null,
  key: string,
  defaultDir: SortDir = "desc",
): SortState {
  if (current && current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: defaultDir };
}

export type SortValue = number | string | null | undefined;

function isEmpty(v: SortValue): boolean {
  return v === null || v === undefined || v === "";
}

export function sortBy<T>(
  rows: T[],
  sort: SortState,
  valueOf: (row: T, key: string) => SortValue,
): T[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const va = valueOf(a.row, sort.key);
      const vb = valueOf(b.row, sort.key);
      const ea = isEmpty(va);
      const eb = isEmpty(vb);
      if (ea && eb) return a.index - b.index;
      if (ea) return 1;
      if (eb) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        if (va === vb) return a.index - b.index;
        return (va - vb) * dir;
      }
      const cmp = String(va).localeCompare(String(vb), "zh");
      return cmp !== 0 ? cmp * dir : a.index - b.index;
    })
    .map((x) => x.row);
}
