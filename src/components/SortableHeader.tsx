import type { CSSProperties, ReactNode } from "react";
import type { SortState } from "@/utils/sort";

export default function SortableHeader({
  label,
  subtitle,
  sortKey,
  sort,
  onSort,
  className,
  style,
  title,
  align = "center",
  hoverClass = "hover:text-indigo-600",
  activeClass = "text-indigo-600",
}: {
  label: ReactNode;
  subtitle?: ReactNode;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  className?: string;
  style?: CSSProperties;
  title?: string;
  align?: "left" | "center" | "right";
  hoverClass?: string;
  activeClass?: string;
}) {
  const active = sort?.key === sortKey;
  const dir = active ? sort?.dir : undefined;
  const alignClass =
    align === "left" ? "items-start" : align === "right" ? "items-end" : "items-center";

  return (
    <th className={className} style={style} title={title} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex w-full flex-col gap-0.5 ${alignClass} transition ${hoverClass}`}
      >
        <span className="inline-flex items-center gap-1">
          <span>{label}</span>
          <span className="inline-flex flex-col leading-none">
            <span className={`text-[8px] ${active && dir === "asc" ? activeClass : "text-slate-300"}`}>
              ▲
            </span>
            <span className={`text-[8px] ${active && dir === "desc" ? activeClass : "text-slate-300"}`}>
              ▼
            </span>
          </span>
        </span>
        {subtitle !== undefined && subtitle !== null && (
          <span className="text-[10px] font-normal text-slate-400">{subtitle}</span>
        )}
      </button>
    </th>
  );
}
