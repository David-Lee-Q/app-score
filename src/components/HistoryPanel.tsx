import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { BatchItemResult, HistoryEntry, ReviewDecision, ScoreReport } from "@/types";
import ScoreResult from "@/components/ScoreResult";
import Button from "@/components/Button";
import { Icon } from "@/components/icons";
import TopicFlag from "@/components/TopicFlag";
import SortableHeader from "@/components/SortableHeader";
import CommentCell from "@/components/CommentCell";
import {
  exportResultsCsv,
  exportSingleResultCsv,
  exportTrackedXlsx,
} from "@/utils/spreadsheet";
import { deleteHistory, fetchHistory, patchHistoryDecision, patchHistoryEntry, patchHistoryItem } from "@/utils/history";
import { weightedFiveDim } from "@/utils/score";
import { sortBy, toggleSort, type SortState, type SortValue } from "@/utils/sort";
import { REVIEW_DECISIONS } from "@/config/decisions";
import { generateRankingPoster } from "@/utils/poster";
import { resolveAppNames } from "@/api/score";
import { validateLink } from "@/utils/validate";

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

function ApprovalTags({
  value,
  onSelect,
}: {
  value?: ReviewDecision;
  onSelect: (decision: ReviewDecision | null) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1">
      {REVIEW_DECISIONS.map((d) => {
        const active = value === d.value;
        return (
          <button
            key={d.value}
            type="button"
            onClick={() => onSelect(active ? null : d.value)}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
              active
                ? d.active
                : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600"
            }`}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

function LinkCell({ url }: { url: string }) {
  if (!url) return <span className="text-xs text-slate-300">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-600 transition hover:border-indigo-300 hover:bg-indigo-100"
    >
      <Icon name="external" className="h-3.5 w-3.5" />
      打开
    </a>
  );
}

function EditableScoreCell({
  value,
  edited,
  onCommit,
  max = 100,
  prefix = "",
  idleClass = "text-slate-700",
}: {
  value: number | null;
  edited: boolean;
  onCommit: (value: number | null) => void;
  max?: number;
  prefix?: string;
  idleClass?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  function start() {
    setDraft(value === null ? "" : String(value));
    setInvalid(false);
    setEditing(true);
  }

  function parseDraft(): number | null | undefined {
    const trimmed = draft.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.min(max, Math.round(n)));
  }

  function confirm() {
    const parsed = parseDraft();
    if (parsed === undefined) {
      setInvalid(true);
      return;
    }
    setEditing(false);
    onCommit(parsed);
  }

  function cancel() {
    setEditing(false);
    setInvalid(false);
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={max}
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onFocus={(e) => e.target.select()}
          onBlur={cancel}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirm();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className={`w-14 rounded-md border px-1.5 py-1 text-center text-sm text-slate-700 focus:outline-none ${
            invalid ? "border-rose-400" : "border-indigo-300 focus:border-indigo-400"
          }`}
        />
        <button
          type="button"
          title="确认修改"
          onMouseDown={(e) => e.preventDefault()}
          onClick={confirm}
          className="rounded p-0.5 text-emerald-600 transition hover:bg-emerald-50"
        >
          <Icon name="check" className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="取消"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100"
        >
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      title={edited ? "已人工修改，点击可再次修改" : "点击修改分值"}
      className={`min-w-[2.5rem] rounded-md px-1.5 py-1 text-sm transition hover:bg-slate-100 ${
        edited
          ? "text-rose-600"
          : value === null
            ? "text-xs text-slate-400"
            : idleClass
      }`}
    >
      {value === null ? "待评" : `${prefix}${value}`}
    </button>
  );
}

function batchResultSortValue(item: BatchItemResult, key: string): SortValue {
  if (key === "name") return item.name || "";
  const report = item.report;
  if (!report) return null;
  switch (key) {
    case "fiveDim":
      return report.fiveDimScore;
    case "openSource":
      return report.openSourceBonus;
    case "directed":
      return report.directedTopicBonus;
    case "total":
      return report.total;
    default: {
      const dim = report.dimensions.find((d) => d.key === key);
      return dim?.score ?? null;
    }
  }
}

type DecisionFilter = ReviewDecision | "pending";

function BatchTable({
  entry,
  onDecision,
  onScoreChange,
  onBonusChange,
  onCommentChange,
  onRefreshName,
  refreshingNameId,
}: {
  entry: HistoryEntry;
  onDecision: (itemId: string, decision: ReviewDecision | null) => void;
  onScoreChange: (itemId: string, dimKey: string, value: number | null) => void;
  onBonusChange: (
    itemId: string,
    which: "openSourceBonus" | "directedTopicBonus",
    value: number,
  ) => void;
  onCommentChange: (itemId: string, comment: string) => void;
  onRefreshName: (itemId: string) => void;
  refreshingNameId: string | null;
}) {
  const items = entry.batch?.items ?? [];
  const dimensions = entry.dimensions;
  const sortByTopic = !!entry.batch?.sortByTopic;
  const showTrackTopic = !sortByTopic;
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const [decisionFilters, setDecisionFilters] = useState<
    Record<string, DecisionFilter | null>
  >({});

  function handleSort(key: string) {
    setSort((prev) => toggleSort(prev, key));
  }

  const colCount = dimensions.length + (showTrackTopic ? 14 : 12);

  const pinCols: { key: string; width: number }[] = [{ key: "name", width: 200 }];
  if (showTrackTopic) pinCols.push({ key: "track", width: 76 }, { key: "topic", width: 200 });
  pinCols.push(
    { key: "cosmocodeUrl", width: 96 },
    { key: "openlabUrl", width: 74 },
    { key: "repoUrl", width: 64 },
  );
  const linkBase = showTrackTopic ? 3 : 1;
  function pinStyle(i: number, header = false): CSSProperties {
    const left = pinCols.slice(0, i).reduce((sum, c) => sum + c.width, 0);
    return {
      position: "sticky",
      left,
      width: pinCols[i].width,
      minWidth: pinCols[i].width,
      maxWidth: pinCols[i].width,
      overflow: "hidden",
      zIndex: header ? 20 : 10,
      backgroundColor: header ? "#f8fafc" : "#ffffff",
    };
  }

  const groups: { key: string; label: string; rows: BatchItemResult[] }[] = [];
  if (sortByTopic) {
    const map = new Map<string, BatchItemResult[]>();
    for (const item of items) {
      const key = (item.topic || "").trim() || "未填写赛题";
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    for (const [key, rows] of map) groups.push({ key, label: key, rows });
  } else {
    groups.push({ key: "__all__", label: "", rows: items });
  }

  function renderDetail(item: BatchItemResult) {
    return (
      <>
        {item.error && (
          <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
            报错记录：{item.error}
          </p>
        )}
        {item.report ? (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-slate-600">
              <span className="font-medium text-slate-700">综合评价：</span>
              {item.report.summary}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {item.report.dimensions.map((d) => (
                <div
                  key={d.key}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">
                      {d.name}
                      <span className="ml-1 font-normal text-slate-400">
                        {d.weight}%
                      </span>
                    </span>
                    <span className="font-semibold text-indigo-600">
                      {d.score === null ? "待评" : d.score}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {d.reason}
                  </p>
                </div>
              ))}
            </div>
            {item.report.openSourceReason && (
              <p className="text-xs text-slate-500">
                <span className="font-medium text-slate-700">开源加分依据：</span>
                {item.report.openSourceReason}
              </p>
            )}
          </div>
        ) : null}
      </>
    );
  }

  function renderDecisionTags(groupKey: string, rows: BatchItemResult[]) {
    const activeFilter = decisionFilters[groupKey] ?? null;
    const btnBase =
      "rounded-full border px-2 py-0.5 text-[11px] transition whitespace-nowrap";
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() =>
            setDecisionFilters((prev) => ({ ...prev, [groupKey]: null }))
          }
          className={`${btnBase} ${
            activeFilter === null
              ? "border-indigo-300 bg-indigo-100 text-indigo-700"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
        >
          全部 {rows.length}
        </button>
        {REVIEW_DECISIONS.map((d) => {
          const count = rows.filter((r) => r.decision === d.value).length;
          const isActive = activeFilter === d.value;
          return (
            <button
              key={d.value}
              type="button"
              title={
                isActive ? `取消筛选「${d.label}」` : `筛选「${d.label}」`
              }
              onClick={() =>
                setDecisionFilters((prev) => ({
                  ...prev,
                  [groupKey]: prev[groupKey] === d.value ? null : d.value,
                }))
              }
              className={`${btnBase} ${
                isActive
                  ? `${d.active} shadow-sm`
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {d.label} {count}
            </button>
          );
        })}
        {(() => {
          const pendingCount = rows.filter((r) => !r.decision).length;
          const isActive = activeFilter === "pending";
          return (
            <button
              type="button"
              title={isActive ? "取消筛选「待评」" : "筛选「待评」（未设置评审状态）"}
              onClick={() =>
                setDecisionFilters((prev) => ({
                  ...prev,
                  [groupKey]: prev[groupKey] === "pending" ? null : "pending",
                }))
              }
              className={`${btnBase} ml-2 border-dashed ${
                isActive
                  ? "border-indigo-300 bg-indigo-100 text-indigo-700 shadow-sm"
                  : "border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700"
              }`}
            >
              待评 {pendingCount}
            </button>
          );
        })()}
      </div>
    );
  }

  function renderTable(rows: BatchItemResult[], groupKey: string) {
    const activeFilter = decisionFilters[groupKey] ?? null;
    const filtered =
      activeFilter === "pending"
        ? rows.filter((r) => !r.decision)
        : activeFilter
          ? rows.filter((r) => r.decision === activeFilter)
          : rows;
    const display = sort ? sortBy(filtered, sort, batchResultSortValue) : filtered;
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1320px] whitespace-nowrap text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <SortableHeader
                label="应用名称"
                sortKey="name"
                sort={sort}
                onSort={handleSort}
                align="left"
                className="px-3 py-2 font-medium"
                style={pinStyle(0, true)}
              />
              {showTrackTopic && (
                <th className="px-3 py-2 font-medium" style={pinStyle(1, true)}>
                  赛道
                </th>
              )}
              {showTrackTopic && (
                <th className="px-3 py-2 font-medium" style={pinStyle(2, true)}>
                  赛题
                </th>
              )}
              <th
                className="px-2 py-2 font-medium"
                style={pinStyle(linkBase, true)}
                title="COSMO Code 应用链接"
              >
                COSMO Code
              </th>
              <th
                className="px-2 py-2 font-medium"
                style={pinStyle(linkBase + 1, true)}
                title="OpenLab 文章链接"
              >
                OpenLab
              </th>
              <th
                className="px-2 py-2 font-medium"
                style={pinStyle(linkBase + 2, true)}
                title="开源代码仓"
              >
                代码仓
              </th>
              {dimensions.map((d) => (
                <SortableHeader
                  key={d.key}
                  label={d.name}
                  subtitle={`${d.weight}%`}
                  sortKey={d.key}
                  sort={sort}
                  onSort={handleSort}
                  className="px-3 py-2 font-medium"
                />
              ))}
              <SortableHeader
                label="五维分"
                sortKey="fiveDim"
                sort={sort}
                onSort={handleSort}
                className="border-l border-indigo-100 bg-indigo-50 px-3 py-2 font-medium text-indigo-600"
              />
              <SortableHeader
                label="开源加分"
                sortKey="openSource"
                sort={sort}
                onSort={handleSort}
                className="px-3 py-2 font-medium"
              />
              <SortableHeader
                label="定向加分"
                sortKey="directed"
                sort={sort}
                onSort={handleSort}
                className="px-3 py-2 font-medium"
              />
              <SortableHeader
                label="综合总分"
                sortKey="total"
                sort={sort}
                onSort={handleSort}
                hoverClass="hover:text-white"
                activeClass="text-white"
                className="bg-indigo-600 px-3 py-2 font-medium text-white"
              />
              <th className="px-3 py-2 text-center font-medium">状态</th>
              <th className="px-3 py-2 text-center font-medium">评审</th>
              <th className="px-3 py-2 text-center font-medium">详情</th>
              <th className="px-3 py-2 text-center font-medium">人工评价</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {display.length === 0 && (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-6 text-center text-xs text-slate-400"
                >
                  该评审状态下暂无应用
                </td>
              </tr>
            )}
            {display.map((item, idx) => {
              const rowKey = item.id ?? `row-${idx}`;
              const dimByKey = new Map(
                (item.report?.dimensions ?? []).map((d) => [d.key, d]),
              );
              const isOpen = openRow === rowKey;
              return (
                <Fragment key={rowKey}>
                  <tr className="text-slate-700">
                    <td
                      className="px-3 py-2"
                      style={pinStyle(0)}
                      title={
                        item.error
                          ? `${item.name || "—"}（报错：${item.error}）`
                          : item.cosmocodeUrl
                            ? "双击名称可刷新获取"
                            : item.name || "—"
                      }
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          onDoubleClick={() => {
                            if (item.id && item.cosmocodeUrl) onRefreshName(item.id);
                          }}
                          className={`min-w-0 flex-1 truncate font-medium text-slate-800 ${
                            item.id && item.cosmocodeUrl ? "cursor-pointer" : ""
                          }`}
                        >
                          {item.name || "—"}
                        </span>
                        {refreshingNameId === item.id && (
                          <span className="shrink-0 animate-spin text-indigo-500">
                            <Icon name="refresh" className="h-3.5 w-3.5" />
                          </span>
                        )}
                        {item.error && (
                          <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                            报错
                          </span>
                        )}
                      </div>
                    </td>
                    {showTrackTopic && (
                      <td className="px-3 py-2 text-xs text-slate-500" style={pinStyle(1)}>
                        {item.track || "—"}
                      </td>
                    )}
                    {showTrackTopic && (
                      <td
                        className="px-3 py-2 text-xs text-slate-500"
                        style={pinStyle(2)}
                      >
                        <span className="block truncate" title={item.topic}>
                          {item.topic || "—"}
                        </span>
                      </td>
                    )}
                    <td className="px-2 py-2" style={pinStyle(linkBase)}>
                      <LinkCell url={item.cosmocodeUrl} />
                    </td>
                    <td className="px-2 py-2" style={pinStyle(linkBase + 1)}>
                      <LinkCell url={item.openlabUrl} />
                    </td>
                    <td className="px-2 py-2" style={pinStyle(linkBase + 2)}>
                      <LinkCell url={item.repoUrl} />
                    </td>
                    {dimensions.map((d) => {
                      const cell = dimByKey.get(d.key);
                      return (
                        <td key={d.key} className="px-3 py-2 text-center">
                          {item.report && item.id ? (
                            <EditableScoreCell
                              value={cell?.score ?? null}
                              edited={Boolean(cell?.edited)}
                              onCommit={(v) => onScoreChange(item.id!, d.key, v)}
                            />
                          ) : cell?.score === null || cell?.score === undefined ? (
                            <span className="text-xs text-slate-400">待评</span>
                          ) : (
                            cell.score
                          )}
                        </td>
                      );
                    })}
                    <td className="border-l border-indigo-100 bg-indigo-50/60 px-3 py-2 text-center font-semibold text-slate-700">
                      {item.report ? Math.round(item.report.fiveDimScore) : "—"}
                    </td>
                    <td className="px-3 py-2 text-center font-semibold">
                      {item.report && item.id ? (
                        <EditableScoreCell
                          value={item.report.openSourceBonus}
                          edited={Boolean(item.report.openSourceEdited)}
                          idleClass="text-emerald-600"
                          max={5}
                          prefix="+"
                          onCommit={(v) =>
                            onBonusChange(item.id!, "openSourceBonus", v ?? 0)
                          }
                        />
                      ) : item.report ? (
                        <span className="text-emerald-600">
                          +{item.report.openSourceBonus}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-semibold">
                      {item.report && item.id ? (
                        <EditableScoreCell
                          value={item.report.directedTopicBonus}
                          edited={Boolean(item.report.directedEdited)}
                          idleClass="text-violet-600"
                          max={10}
                          prefix="+"
                          onCommit={(v) =>
                            onBonusChange(item.id!, "directedTopicBonus", v ?? 0)
                          }
                        />
                      ) : item.report ? (
                        <span className="text-violet-600">
                          +{item.report.directedTopicBonus}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="bg-indigo-600 px-3 py-2 text-center font-bold text-white">
                      {item.report ? (
                        <span className="inline-flex items-center">
                          {Math.round(item.report.total)}
                          <TopicFlag check={item.report.directedTopicCheck} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {item.status === "done" ? (
                        <span className="text-emerald-600">已完成</span>
                      ) : item.status === "error" ? (
                        <span className="text-rose-600">失败</span>
                      ) : (
                        <span className="text-slate-400">未评分</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ApprovalTags
                        value={item.decision}
                        onSelect={(decision) => {
                          if (item.id) onDecision(item.id, decision);
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {item.report || item.error ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          onClick={() => setOpenRow(isOpen ? null : rowKey)}
                        >
                          {isOpen ? "收起" : "查看"}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center align-top">
                      {item.id && (
                        <CommentCell
                          value={item.comment}
                          onCommit={(comment) => onCommentChange(item.id as string, comment)}
                        />
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50/70">
                      <td colSpan={colCount} className="px-4 py-3">
                        {renderDetail(item)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        if (!group.label) {
          return (
            <div
              key={group.key}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                <span className="text-xs text-slate-400">
                  全部应用 {group.rows.length} 个
                </span>
                {renderDecisionTags(group.key, group.rows)}
              </div>
              {renderTable(group.rows, group.key)}
            </div>
          );
        }
        const scored = group.rows.filter((r) => r.report);
        const avg = scored.length
          ? Math.round(
              scored.reduce((sum, r) => sum + (r.report?.total ?? 0), 0) /
                scored.length,
            )
          : null;
        return (
          <div key={group.key} className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-800">{group.label}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {group.rows.length} 个应用
                </span>
                {avg !== null && (
                  <span className="text-xs text-slate-400">均分 {avg}</span>
                )}
              </div>
              {renderDecisionTags(group.key, group.rows)}
            </div>
            {renderTable(group.rows, group.key)}
          </div>
        );
      })}
    </div>
  );
}

export default function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshingNameId, setRefreshingNameId] = useState<string | null>(null);
  const savingRef = useRef(0);

  async function persist(task: () => Promise<void>) {
    savingRef.current += 1;
    try {
      await task();
    } finally {
      savingRef.current -= 1;
    }
  }

  const sameNameOf = useCallback(
    (target: HistoryEntry) =>
      entries
        .filter((e) => e.id !== target.id && e.title === target.title)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [entries],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEntries(await fetchHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取历史失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (savingRef.current > 0) return;
      try {
        setEntries(await fetchHistory());
      } catch {
        // 轮询失败时保持当前数据
      }
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    const id = deleteTarget.id;
    setDeleting(true);
    try {
      await deleteHistory(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (openId === id) setOpenId(null);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  function handleDownload(entry: HistoryEntry) {
    if (entry.kind === "single" && entry.single?.report) {
      exportSingleResultCsv(
        entry.single.meta,
        entry.single.report,
        entry.dimensions,
      );
    } else if (entry.kind === "batch" && entry.batch) {
      const name = (entry.title || "批量评分").replace(/[\\/:*?"<>|]/g, "_");
      exportResultsCsv(entry.batch.items, entry.dimensions, `${name}_预审打分结果.csv`);
    }
  }

  async function handleDecision(
    entry: HistoryEntry,
    itemId: string,
    decision: ReviewDecision | null,
  ) {
    if (entry.kind !== "batch" || !entry.batch) return;
    const prevItems = entry.batch.items;
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entry.id || !e.batch) return e;
        const items = e.batch.items.map((it) =>
          it.id === itemId ? { ...it, decision: decision ?? undefined } : it,
        );
        return { ...e, batch: { ...e.batch, items } };
      }),
    );
    try {
      await persist(() => patchHistoryDecision(entry.id, itemId, decision));
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id && e.batch
            ? { ...e, batch: { ...e.batch, items: prevItems } }
            : e,
        ),
      );
      setError(err instanceof Error ? err.message : "更新评审状态失败");
    }
  }

  async function handleScoreChange(
    entry: HistoryEntry,
    itemId: string,
    dimKey: string,
    value: number | null,
  ) {
    if (entry.kind !== "batch" || !entry.batch) return;
    const prevItems = entry.batch.items;
    const current = prevItems.find((it) => it.id === itemId);
    if (!current || !current.report) return;
    const target = current.report.dimensions.find((d) => d.key === dimKey);
    if (!target || target.score === value) return;
    const base =
      target.originalScore !== undefined ? target.originalScore : target.score;
    const dimensions = current.report.dimensions.map((d) =>
      d.key === dimKey
        ? { ...d, score: value, originalScore: base, edited: value !== base }
        : d,
    );
    const fiveDimScore = weightedFiveDim(dimensions);
    const report: ScoreReport = {
      ...current.report,
      dimensions,
      fiveDimScore,
      total:
        fiveDimScore +
        current.report.openSourceBonus +
        current.report.directedTopicBonus,
    };
    const updated: BatchItemResult = { ...current, report };
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entry.id && e.batch
          ? {
              ...e,
              batch: {
                ...e.batch,
                items: e.batch.items.map((it) => (it.id === itemId ? updated : it)),
              },
            }
          : e,
      ),
    );
    try {
      await persist(() => patchHistoryItem(entry.id, itemId, { report }));
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id && e.batch
            ? { ...e, batch: { ...e.batch, items: prevItems } }
            : e,
        ),
      );
      setError(err instanceof Error ? err.message : "更新分值失败");
    }
  }

  async function handleBonusChange(
    entry: HistoryEntry,
    itemId: string,
    which: "openSourceBonus" | "directedTopicBonus",
    value: number,
  ) {
    if (entry.kind !== "batch" || !entry.batch) return;
    const prevItems = entry.batch.items;
    const current = prevItems.find((it) => it.id === itemId);
    if (!current || !current.report) return;
    const report = current.report;
    let next: ScoreReport;
    if (which === "openSourceBonus") {
      const base =
        report.openSourceOriginal !== undefined
          ? report.openSourceOriginal
          : report.openSourceBonus;
      const edited = value !== base;
      if (report.openSourceBonus === value && Boolean(report.openSourceEdited) === edited) {
        return;
      }
      next = {
        ...report,
        openSourceBonus: value,
        openSourceOriginal: base,
        openSourceEdited: edited,
        total: report.fiveDimScore + value + report.directedTopicBonus,
      };
    } else {
      const base =
        report.directedOriginal !== undefined
          ? report.directedOriginal
          : report.directedTopicBonus;
      const edited = value !== base;
      if (report.directedTopicBonus === value && Boolean(report.directedEdited) === edited) {
        return;
      }
      next = {
        ...report,
        directedTopicBonus: value,
        directedOriginal: base,
        directedEdited: edited,
        total: report.fiveDimScore + report.openSourceBonus + value,
      };
    }
    const updated: BatchItemResult = { ...current, report: next };
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entry.id && e.batch
          ? {
              ...e,
              batch: {
                ...e.batch,
                items: e.batch.items.map((it) => (it.id === itemId ? updated : it)),
              },
            }
          : e,
      ),
    );
    try {
      await persist(() => patchHistoryItem(entry.id, itemId, { report: next }));
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id && e.batch
            ? { ...e, batch: { ...e.batch, items: prevItems } }
            : e,
        ),
      );
      setError(err instanceof Error ? err.message : "更新加分失败");
    }
  }

  async function handleCommentChange(
    entry: HistoryEntry,
    itemId: string,
    comment: string,
  ) {
    if (entry.kind !== "batch" || !entry.batch) return;
    const prevItems = entry.batch.items;
    const current = prevItems.find((it) => it.id === itemId);
    if (!current) return;
    const updated: BatchItemResult = { ...current, comment: comment || undefined };
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entry.id && e.batch
          ? {
              ...e,
              batch: {
                ...e.batch,
                items: e.batch.items.map((it) => (it.id === itemId ? updated : it)),
              },
            }
          : e,
      ),
    );
    try {
      await persist(() => patchHistoryItem(entry.id, itemId, { comment: comment || "" }));
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id && e.batch
            ? { ...e, batch: { ...e.batch, items: prevItems } }
            : e,
        ),
      );
      setError(err instanceof Error ? err.message : "保存人工评价失败");
    }
  }

  async function handleRefreshName(entry: HistoryEntry, itemId: string) {
    if (entry.kind !== "batch" || !entry.batch) return;
    const item = entry.batch.items.find((it) => it.id === itemId);
    const url = item?.cosmocodeUrl?.trim() ?? "";
    if (!item || !url || validateLink("cosmocodeUrl", url).status !== "ok") {
      setError("该行缺少可访问的 COSMO Code 应用链接，无法刷新应用名称");
      return;
    }
    setRefreshingNameId(itemId);
    setError("");
    try {
      const res = await resolveAppNames([url]);
      const name = res[url]?.name?.trim();
      if (!name) {
        setError("未能匹配到应用名称，请确认应用链接是否公开可访问");
        return;
      }
      const prevItems = entry.batch.items;
      const updated: BatchItemResult = { ...item, name };
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id && e.batch
            ? {
                ...e,
                batch: {
                  ...e.batch,
                  items: e.batch.items.map((it) => (it.id === itemId ? updated : it)),
                },
              }
            : e,
        ),
      );
      try {
        await persist(() => patchHistoryItem(entry.id, itemId, { name }));
      } catch (err) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id && e.batch
              ? { ...e, batch: { ...e.batch, items: prevItems } }
              : e,
          ),
        );
        throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新应用名称失败");
    } finally {
      setRefreshingNameId(null);
    }
  }

  async function handleToggleSort(entry: HistoryEntry) {
    if (entry.kind !== "batch" || !entry.batch) return;
    const nextSortByTopic = !entry.batch.sortByTopic;
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entry.id && e.batch
          ? { ...e, batch: { ...e.batch, sortByTopic: nextSortByTopic } }
          : e,
      ),
    );
    try {
      await persist(() =>
        patchHistoryEntry(entry.id, { batch: { sortByTopic: nextSortByTopic } }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换分组失败");
      void load();
    }
  }

  function handleDownloadSorted(entry: HistoryEntry) {
    if (entry.kind !== "batch" || !entry.batch) return;
    const name = (entry.title || "批量评分").replace(/[\\/:*?"<>|]/g, "_");
    exportTrackedXlsx(
      entry.batch.items,
      entry.dimensions,
      `${name}_赛道排序结果.xlsx`,
    );
  }

  function handlePoster(entry: HistoryEntry) {
    if (entry.kind !== "batch" || !entry.batch) return;
    const name = (entry.title || "批量评分").replace(/[\\/:*?"<>|]/g, "_");
    try {
      generateRankingPoster(entry.batch.items, {
        fileName: `${name}_排行榜.png`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成海报失败");
    }
  }

  const hasDownloadable = (entry: HistoryEntry) =>
    (entry.kind === "single" && !!entry.single?.report) ||
    (entry.kind === "batch" && !!entry.batch && (entry.batch.items?.length ?? 0) > 0);

  const deleteSameName = deleteTarget ? sameNameOf(deleteTarget) : [];
  const deleteIsLatest =
    !!deleteTarget &&
    deleteSameName.every(
      (e) =>
        new Date(deleteTarget.createdAt).getTime() >=
        new Date(e.createdAt).getTime(),
    );
  const deleteStrong = deleteSameName.length > 0 && deleteIsLatest;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-base font-semibold text-slate-800">评分历史</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            保存每次单个与批量评分结果，支持查看与下载，最多保留最近 100 条
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void load()}
        >
          刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">
          {error}
        </div>
      )}

      {loading ? (
        <p className="px-2 text-sm text-slate-400">加载中…</p>
      ) : entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-400">
          暂无评分历史，完成评分后自动留存
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => {
            const isOpen = openId === entry.id;
            return (
              <li
                key={entry.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      entry.kind === "batch"
                        ? "bg-violet-50 text-violet-600"
                        : "bg-indigo-50 text-indigo-600"
                    }`}
                  >
                    {entry.kind === "batch" ? "批量" : "单个"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">
                      {entry.title}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {entry.subtitle ? `${entry.subtitle} · ` : ""}
                      {formatTime(entry.createdAt)}
                      {entry.calibrated ? " · 已全局校准" : ""}
                    </div>
                  </div>
                  {typeof entry.total === "number" && (
                    <div className="text-right">
                      <span className="text-xl font-bold text-indigo-600">
                        {Math.round(entry.total)}
                      </span>
                      <span className="block text-[10px] text-slate-400">综合总分</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      onClick={() => setOpenId(isOpen ? null : entry.id)}
                    >
                      {isOpen ? "收起" : "查看"}
                    </Button>
                    {entry.kind === "batch" &&
                      (entry.batch?.items?.length ?? 0) > 0 && (
                        <Button
                          type="button"
                          variant="soft"
                          size="xs"
                          onClick={() => void handleToggleSort(entry)}
                        >
                          {entry.batch?.sortByTopic ? "恢复原始顺序" : "按赛题排序"}
                        </Button>
                      )}
                    {hasDownloadable(entry) && (
                      <Button
                        type="button"
                        variant="soft"
                        size="xs"
                        onClick={() => handleDownload(entry)}
                      >
                        <Icon name="download" className="h-3.5 w-3.5" />
                        原始评分
                      </Button>
                    )}
                    {entry.kind === "batch" &&
                      (entry.batch?.items?.length ?? 0) > 0 && (
                        <Button
                          type="button"
                          variant="primary"
                          size="xs"
                          onClick={() => handleDownloadSorted(entry)}
                        >
                          <Icon name="download" className="h-3.5 w-3.5" />
                          分组排序
                        </Button>
                      )}
                    {entry.kind === "batch" &&
                      (entry.batch?.items?.length ?? 0) > 0 && (
                        <Button
                          type="button"
                          variant="soft"
                          size="xs"
                          onClick={() => handlePoster(entry)}
                        >
                          <Icon name="download" className="h-3.5 w-3.5" />
                          排行榜
                        </Button>
                      )}
                    <Button
                      type="button"
                      variant="danger"
                      size="xs"
                      onClick={() => setDeleteTarget(entry)}
                    >
                      删除
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                    {entry.kind === "single" ? (
                      entry.single?.error ? (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                          报错记录：{entry.single.error}
                        </div>
                      ) : entry.single?.report ? (
                        <ScoreResult report={entry.single.report} />
                      ) : (
                        <p className="text-sm text-slate-400">无内容</p>
                      )
                    ) : (
                      <BatchTable
                        entry={entry}
                        onDecision={(itemId, decision) =>
                          void handleDecision(entry, itemId, decision)
                        }
                        onScoreChange={(itemId, dimKey, value) =>
                          void handleScoreChange(entry, itemId, dimKey, value)
                        }
                        onBonusChange={(itemId, which, value) =>
                          void handleBonusChange(entry, itemId, which, value)
                        }
                        onCommentChange={(itemId, comment) =>
                          void handleCommentChange(entry, itemId, comment)
                        }
                        onRefreshName={(itemId) =>
                          void handleRefreshName(entry, itemId)
                        }
                        refreshingNameId={refreshingNameId}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <div
            className={`w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl ${
              deleteStrong ? "ring-2 ring-rose-300" : ""
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className={`text-base font-semibold ${
                deleteStrong ? "text-rose-600" : "text-slate-800"
              }`}
            >
              {deleteStrong ? "强提醒：正在删除同名记录中最新的一条" : "确认删除评分历史"}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {deleteStrong ? (
                <>
                  该记录与 <span className="font-semibold">{deleteSameName.length}</span> 条同名历史记录（标题「
                  <span className="font-semibold">{deleteTarget.title}</span>」）重复，且是其中
                  <span className="font-semibold text-rose-600">时间最新</span>的一条。删除后将只保留更早的同名记录，且此操作不可恢复。
                </>
              ) : deleteSameName.length > 0 ? (
                <>
                  存在 <span className="font-semibold">{deleteSameName.length}</span> 条同名历史记录，删除后仍会保留其余同名记录。此操作不可恢复。
                </>
              ) : (
                <>确定删除该条评分历史？此操作不可恢复。</>
              )}
            </p>

            {deleteSameName.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">
                  同名记录（时间倒序，删除后至少保留一条）：
                </p>
                <ul className="mt-1 space-y-0.5">
                  {deleteSameName.map((e) => (
                    <li key={e.id} className="text-xs text-slate-500">
                      · {formatTime(e.createdAt)}（{e.kind === "batch" ? "批量" : "单个"}）
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {deleteStrong && (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                建议先「下载」最新记录备份，再执行删除。
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? "删除中…" : deleteStrong ? "确认删除最新同名记录" : "确认删除"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
