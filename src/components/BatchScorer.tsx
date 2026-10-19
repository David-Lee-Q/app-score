import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  checkRepos,
  requestCalibrate,
  requestScore,
  resolveAppNames,
  type RepoAccess,
} from "@/api/score";
import Button from "@/components/Button";
import { Icon, type IconName } from "@/components/icons";
import TopicFlag from "@/components/TopicFlag";
import SortableHeader from "@/components/SortableHeader";
import CommentCell from "@/components/CommentCell";
import { SCORE_DIMENSIONS } from "@/config/dimensions";
import type { ApplicationRow, BatchItemResult, HistoryEntry, ScoreReport } from "@/types";
import {
  downloadTemplate,
  exportResultsCsv,
  parseApplicationsFile,
} from "@/utils/spreadsheet";
import { weightedFiveDim } from "@/utils/score";
import { newHistoryId, patchHistoryEntry, saveHistory } from "@/utils/history";
import { sortBy, toggleSort, type SortState, type SortValue } from "@/utils/sort";
import { generateRankingPoster } from "@/utils/poster";
import {
  isLinkKey,
  LINK_RULES,
  validateLink,
  type LinkKey,
} from "@/utils/validate";

function buildBatchHistory(
  items: BatchItemResult[],
  fileName: string,
): HistoryEntry {
  const done = items.filter((i) => i.status === "done").length;
  const totals = items
    .filter((i) => i.report)
    .map((i) => i.report!.total);
  const best = totals.length ? Math.max(...totals) : undefined;
  return {
    id: newHistoryId(),
    kind: "batch",
    createdAt: new Date().toISOString(),
    title: fileName || `批量评分（${items.length} 个应用）`,
    subtitle: `共 ${items.length} 个 / 完成 ${done} 个${
      best === undefined ? "" : ` / 最高 ${Math.round(best)} 分`
    }`,
    calibrated: items.some((i) => i.report?.calibrated),
    dimensions: SCORE_DIMENSIONS,
    batch: {
      items,
      fileName,
      originalOrder: items
        .map((i) => i.id)
        .filter((id): id is string => Boolean(id)),
      originalOrderAt: new Date().toISOString(),
    },
  };
}

async function calibrateAll(items: BatchItemResult[]): Promise<BatchItemResult[]> {
  const scored = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.status === "done" && it.report && !it.report.disqualified);
  if (scored.length === 0) return items;

  const payload = scored.map(({ it, idx }) => ({
    index: idx,
    name: it.name,
    topic: it.topic,
    summary: it.report!.summary,
    dimensions: it.report!.dimensions.map((d) => ({
      key: d.key,
      name: d.name,
      score: d.score,
    })),
  }));

  const calibrated = await requestCalibrate(SCORE_DIMENSIONS, payload);
  const calByIndex = new Map(calibrated.map((c) => [c.index, c]));

  return items.map((it, idx) => {
    const cal = calByIndex.get(idx);
    if (!cal || !it.report) return it;
    const scoreByKey = new Map(cal.dimensions.map((d) => [d.key, d.score]));
    const dims = it.report.dimensions.map((d) =>
      scoreByKey.has(d.key) ? { ...d, score: scoreByKey.get(d.key) ?? null } : d,
    );
    const fiveDimScore = weightedFiveDim(dims);
    const report: ScoreReport = {
      ...it.report,
      dimensions: dims,
      fiveDimScore,
      total:
        fiveDimScore + it.report.openSourceBonus + it.report.directedTopicBonus,
      calibrated: true,
    };
    return { ...it, report };
  });
}

function statusBadge(status: BatchItemResult["status"]) {
  switch (status) {
    case "done":
      return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">已完成</span>;
    case "error":
      return <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600">失败</span>;
    case "scoring":
      return <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">评审中…</span>;
    default:
      return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">待评审</span>;
  }
}

function resultSortValue(item: BatchItemResult, key: string): SortValue {
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

const PREVIEW_COLUMNS: {
  key: string;
  label: string;
  width: number;
  nowrap: boolean;
  icon: IconName;
}[] = [
  { key: "workId", label: "作品ID", width: 100, nowrap: true, icon: "id" },
  { key: "personName", label: "姓名", width: 90, nowrap: true, icon: "user" },
  { key: "phone", label: "手机号", width: 130, nowrap: true, icon: "phone" },
  { key: "name", label: "应用名称（选填）", width: 150, nowrap: true, icon: "app" },
  { key: "track", label: "赛道", width: 100, nowrap: true, icon: "flag" },
  { key: "topic", label: "赛题", width: 220, nowrap: true, icon: "target" },
  { key: "cosmocodeUrl", label: "COSMO Code应用链接", width: 260, nowrap: true, icon: "link" },
  { key: "openlabUrl", label: "OpenLab文章链接", width: 260, nowrap: true, icon: "article" },
  { key: "repoUrl", label: "开源代码仓", width: 260, nowrap: true, icon: "code" },
];

const MIN_COL_WIDTH = 80;

type PreviewEditableKey = LinkKey | "name";

export default function BatchScorer() {
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<BatchItemResult[]>([]);
  const [running, setRunning] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrate, setCalibrate] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [edit, setEdit] = useState<{
    rowIndex: number;
    key: PreviewEditableKey;
    value: string;
  } | null>(null);
  const [colWidths, setColWidths] = useState<number[]>(
    PREVIEW_COLUMNS.map((c) => c.width),
  );
  const [repoAccess, setRepoAccess] = useState<Record<string, RepoAccess>>({});
  const [checkingRepos, setCheckingRepos] = useState(false);
  const [autoNamedUrls, setAutoNamedUrls] = useState<Set<string>>(new Set());
  const attemptedLinks = useRef<Set<string>>(new Set());
  const [resolvingNames, setResolvingNames] = useState(false);
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({});
  const [refreshingNameUrl, setRefreshingNameUrl] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<
    Record<string, { status: number; note: string }>
  >({});
  const dragRef = useRef<{ index: number; startX: number; startWidth: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const nameClickTimer = useRef<number | null>(null);

  function startResize(e: React.MouseEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      index,
      startX: e.clientX,
      startWidth: colWidths[index],
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(MIN_COL_WIDTH, d.startWidth + (ev.clientX - d.startX));
      setColWidths((prev) => prev.map((w, i) => (i === d.index ? next : w)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const previewTotalWidth = colWidths.reduce((sum, w) => sum + w, 0);

  const finished = items.filter((i) => i.status === "done" || i.status === "error").length;
  const progress = items.length ? Math.round((finished / items.length) * 100) : 0;

  const canStart = rows.length > 0 && !running;

  const missingTopicCount = useMemo(
    () => rows.filter((r) => !r.topic.trim()).length,
    [rows],
  );

  const invalidLinkCount = useMemo(() => {
    let count = 0;
    for (const r of rows) {
      for (const rule of LINK_RULES) {
        const check = validateLink(rule.key, r[rule.key]);
        if (
          check.status === "error" ||
          (rule.key === "cosmocodeUrl" && check.status === "empty")
        ) {
          count += 1;
        }
      }
    }
    return count;
  }, [rows]);

  const repoUrlList = useMemo(
    () => [...new Set(rows.map((r) => r.repoUrl.trim()).filter(Boolean))],
    [rows],
  );

  useEffect(() => {
    if (!repoUrlList.length) {
      setRepoAccess({});
      return;
    }
    let cancelled = false;
    setCheckingRepos(true);
    checkRepos(repoUrlList)
      .then((results) => {
        if (!cancelled) setRepoAccess(results);
      })
      .catch(() => {
        if (!cancelled) setRepoAccess({});
      })
      .finally(() => {
        if (!cancelled) setCheckingRepos(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoUrlList]);

  const privateRepoCount = useMemo(
    () => repoUrlList.filter((u) => repoAccess[u]?.private).length,
    [repoUrlList, repoAccess],
  );

  const unreachableCount = useMemo(
    () =>
      rows.filter((r) => {
        const status = linkStatus[r.cosmocodeUrl.trim()]?.status;
        return status !== undefined && (status === 0 || status >= 400);
      }).length,
    [rows, linkStatus],
  );

  useEffect(() => {
    const pending = [
      ...new Set(
        rows
          .map((r) => r.cosmocodeUrl.trim())
          .filter((u) => u && validateLink("cosmocodeUrl", u).status === "ok")
          .filter((u) => !attemptedLinks.current.has(u)),
      ),
    ];
    if (!pending.length) return;
    pending.forEach((u) => attemptedLinks.current.add(u));
    let cancelled = false;
    setResolvingNames(true);
    resolveAppNames(pending)
      .then((results) => {
        if (cancelled) return;
        setLinkStatus((prev) => {
          const next = { ...prev };
          for (const u of pending) {
            next[u] = { status: results[u]?.status ?? 0, note: results[u]?.note ?? "" };
          }
          return next;
        });
        setRows((prev) =>
          prev.map((r) => {
            if (r.name.trim()) return r;
            const resolved = results[r.cosmocodeUrl.trim()];
            return resolved?.name ? { ...r, name: resolved.name } : r;
          }),
        );
        const filled = new Set(pending.filter((u) => results[u]?.name));
        if (filled.size) {
          setAutoNamedUrls((prev) => new Set([...prev, ...filled]));
          setResolvedNames((prev) => {
            const next = { ...prev };
            for (const u of filled) next[u] = results[u].name;
            return next;
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setResolvingNames(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  function applyEdit() {
    if (!edit) return;
    const { rowIndex, key, value } = edit;
    const trimmed = value.trim();
    setRows((prev) =>
      prev.map((r, i) => (i === rowIndex ? { ...r, [key]: trimmed } : r)),
    );
    if (key === "name") {
      const url = rows[rowIndex]?.cosmocodeUrl.trim();
      if (url) {
        setAutoNamedUrls((prev) => {
          const next = new Set(prev);
          next.delete(url);
          return next;
        });
      }
    }
    setEdit(null);
  }

  async function refreshName(rowIndex: number) {
    const url = rows[rowIndex]?.cosmocodeUrl.trim();
    if (!url || validateLink("cosmocodeUrl", url).status !== "ok") return;
    setRefreshingNameUrl(url);
    try {
      const res = await resolveAppNames([url]);
      const info = res[url];
      setLinkStatus((prev) => ({
        ...prev,
        [url]: { status: info?.status ?? 0, note: info?.note ?? "" },
      }));
      const name = info?.name?.trim();
      if (name) {
        setRows((prev) =>
          prev.map((r, i) => (i === rowIndex ? { ...r, name } : r)),
        );
        setResolvedNames((prev) => ({ ...prev, [url]: name }));
        setAutoNamedUrls((prev) => new Set([...prev, url]));
      }
    } catch {
      // 忽略刷新失败
    } finally {
      setRefreshingNameUrl(null);
    }
  }

  async function handleFile(file: File) {
    setError("");
    setItems([]);
    setExpanded(new Set());
    setSort(null);
    setSavedEntryId(null);
    try {
      const parsed = await parseApplicationsFile(file);
      setRows(parsed);
      setFileName(file.name);
    } catch (err) {
      setRows([]);
      setFileName("");
      setError(err instanceof Error ? err.message : "文件解析失败");
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  async function runBatch() {
    if (!canStart) return;
    setRunning(true);
    setError("");

    let names = resolvedNames;
    const missing = [
      ...new Set(
        rows
          .filter(
            (r) =>
              !r.name.trim() &&
              r.cosmocodeUrl.trim() &&
              validateLink("cosmocodeUrl", r.cosmocodeUrl).status === "ok",
          )
          .map((r) => r.cosmocodeUrl.trim())
          .filter((u) => !names[u]),
      ),
    ];
    if (missing.length) {
      setResolvingNames(true);
      try {
        const res = await resolveAppNames(missing);
        const add: Record<string, string> = {};
        for (const u of missing) if (res[u]?.name) add[u] = res[u].name;
        names = { ...resolvedNames, ...add };
        setResolvedNames(names);
        const filledUrls = missing.filter((u) => names[u]);
        if (filledUrls.length) {
          setAutoNamedUrls((prev) => new Set([...prev, ...filledUrls]));
        }
      } catch {
        // 匹配失败时忽略，评分仍可继续
      } finally {
        setResolvingNames(false);
      }
    }

    const results: BatchItemResult[] = rows.map((r) => ({
      ...r,
      id: newHistoryId(),
      name: r.name.trim() || names[r.cosmocodeUrl.trim()] || "",
      track: r.track.trim(),
      topic: r.topic.trim(),
      status: "pending",
    }));
    setItems([...results]);

    for (let i = 0; i < results.length; i += 1) {
      const current = results[i];

      if (!current.topic) {
        results[i] = { ...current, status: "error", error: "缺少赛题" };
        setItems([...results]);
        continue;
      }

      results[i] = { ...current, status: "scoring" };
      setItems([...results]);

      try {
        const report = await requestScore({
          name: current.name,
          track: current.track,
          topic: current.topic,
          cosmocodeUrl: current.cosmocodeUrl,
          openlabUrl: current.openlabUrl,
          repoUrl: current.repoUrl,
          dimensions: SCORE_DIMENSIONS,
        });
        results[i] = { ...results[i], status: "done", report };
      } catch (err) {
        results[i] = {
          ...results[i],
          status: "error",
          error: err instanceof Error ? err.message : "评分失败",
        };
      }
      setItems([...results]);
    }

    const doneCount = results.filter((r) => r.status === "done").length;
    if (calibrate && doneCount >= 2) {
      setCalibrating(true);
      try {
        const calibrated = await calibrateAll(results);
        for (let i = 0; i < results.length; i += 1) results[i] = calibrated[i];
        setItems([...results]);
      } catch (err) {
        setError(
          err instanceof Error
            ? `全局校准失败，已保留初评结果：${err.message}`
            : "全局校准失败，已保留初评结果",
        );
      } finally {
        setCalibrating(false);
      }
    }

    setRunning(false);
    const entry = buildBatchHistory(results, fileName);
    setSavedEntryId(entry.id);
    void saveHistory(entry).catch(() => {});
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handlePoster() {
    const base = (fileName || "批量评分").replace(/\.(xlsx|xls|csv)$/i, "");
    try {
      generateRankingPoster(items, { fileName: `${base}_排行榜.png` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成海报失败");
    }
  }

  const hasResults = items.length > 0;

  const displayItems = useMemo(
    () => (sort ? sortBy(items, sort, resultSortValue) : items),
    [items, sort],
  );

  function handleSort(key: string) {
    setSort((prev) => toggleSort(prev, key));
  }

  async function handleCommentChange(itemId: string, comment: string) {
    const nextItems = items.map((it) =>
      it.id === itemId ? { ...it, comment: comment || undefined } : it,
    );
    setItems(nextItems);
    if (!savedEntryId) return;
    try {
      await patchHistoryEntry(savedEntryId, { batch: { items: nextItems } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存人工评价失败");
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <Icon name="upload" className="h-4 w-4 text-indigo-500" />
              批量待评分应用
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              下载模板 → 填写多个应用 → 上传 → 一键批量打分
            </p>
          </div>
          <Button type="button" variant="soft" size="sm" onClick={downloadTemplate}>
            <Icon name="download" className="h-4 w-4" />
            下载表格模板
          </Button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
            dragOver
              ? "border-indigo-400 bg-indigo-50/60"
              : "border-slate-300 bg-slate-50 hover:border-indigo-300"
          }`}
        >
          <Icon name="upload" className="mb-2 h-8 w-8 text-indigo-400" />
          <p className="text-sm font-medium text-slate-700">点击选择或拖拽上传表格</p>
          <p className="mt-1 text-xs text-slate-400">
            支持 .xlsx / .xls / .csv，表头需含「赛道」「赛题」及链接列
          </p>
          {fileName && (
            <p className="mt-2 text-xs text-indigo-600">
              已解析：{fileName}（{rows.length} 条）
            </p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onInputChange}
          />
        </div>

        {missingTopicCount > 0 && (
          <p className="text-xs text-amber-600">
            有 {missingTopicCount} 条记录缺少赛题，将无法评分，请在表格「赛题」列补充
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">
            {error}
          </div>
        )}

        {rows.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs text-slate-400">
              共 {rows.length} 条 · 全部模板字段单行展示，超宽以「…」省略（悬停可见完整内容）· 点击「应用名称」或链接单元格可手动修改 · 拖拽列标题右边界可调整列宽
            </p>
            <p className="mb-1.5 text-xs text-slate-400">
              链接格式校验：
              {invalidLinkCount > 0 ? (
                <span className="text-rose-600">
                  {invalidLinkCount} 个链接有误（红色标记），点击单元格可修改，需确认后生效；COSMO Code应用链接无效、未填或不可访问将直接计 0 分
                </span>
              ) : (
                <span className="text-emerald-600">三个链接格式均正确</span>
              )}
            </p>
            {repoUrlList.length > 0 && (
              <p className="mb-1.5 text-xs text-slate-400">
                代码仓可访问性：
                {checkingRepos ? (
                  <span className="text-indigo-500">检测中…</span>
                ) : privateRepoCount > 0 ? (
                  <span className="text-rose-600">
                    {privateRepoCount} 个仓库不可访问，已标记「私有」（无法读取代码，不参与开源加分）
                  </span>
                ) : (
                  <span className="text-emerald-600">均可公开访问</span>
                )}
              </p>
            )}
            {resolvingNames && (
              <p className="mb-1.5 text-xs text-slate-400">
                应用名称匹配中：
                <span className="text-indigo-500">正在根据 COSMO Code 应用链接读取并匹配应用名称…</span>
              </p>
            )}
            {unreachableCount > 0 && (
              <p className="mb-1.5 text-xs text-amber-600">
                有 {unreachableCount} 个 COSMO Code 应用链接不可访问（黄色标记），将直接计 0 分
              </p>
            )}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table
                className="table-fixed text-left text-sm"
                style={{ minWidth: previewTotalWidth }}
              >
                <colgroup>
                  {colWidths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    {PREVIEW_COLUMNS.map((col, i) => (
                      <th key={col.key} className="relative px-3 py-2 font-medium">
                        <span className="flex items-center gap-1.5">
                          <Icon name={col.icon} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{col.label}</span>
                        </span>
                        <span
                          onMouseDown={(e) => startResize(e, i)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none bg-transparent hover:bg-indigo-300"
                          title="拖拽调整列宽"
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, idx) => {
                    const valueOf = (key: (typeof PREVIEW_COLUMNS)[number]["key"]) => {
                      switch (key) {
                        case "name":
                          return row.name;
                        case "workId":
                          return row.workId ?? "";
                        case "personName":
                          return row.personName ?? "";
                        case "phone":
                          return row.phone ?? "";
                        case "track":
                          return row.track;
                        case "topic":
                          return row.topic;
                        case "cosmocodeUrl":
                          return row.cosmocodeUrl;
                        case "openlabUrl":
                          return row.openlabUrl;
                        case "repoUrl":
                          return row.repoUrl;
                        default:
                          return "";
                      }
                    };
                    return (
                      <tr key={idx} className="text-slate-700">
                        {PREVIEW_COLUMNS.map((col) => {
                          const raw = valueOf(col.key);
                          const isLink = isLinkKey(col.key);
                          const isEditable = isLink || col.key === "name";
                          const check = isLink ? validateLink(col.key as LinkKey, raw) : null;
                          const isEmptyAppLink =
                            col.key === "cosmocodeUrl" && check?.status === "empty";
                          const isError =
                            check?.status === "error" || isEmptyAppLink;
                          const errMsg = isEmptyAppLink
                            ? "未填写，缺少应用链接将直接计 0 分"
                            : check?.message;
                          const repoInfo =
                            col.key === "repoUrl" && raw
                              ? repoAccess[raw.trim()]
                              : undefined;
                          const linkInfo =
                            col.key === "cosmocodeUrl" && raw
                              ? linkStatus[raw.trim()]
                              : undefined;
                          const isWarn =
                            !isError &&
                            !!linkInfo &&
                            (linkInfo.status === 0 || linkInfo.status >= 400);
                          const warnMsg = isWarn
                            ? linkInfo!.status
                              ? `应用链接不可访问（HTTP ${linkInfo!.status}），将计 0 分`
                              : "应用链接无法访问，将计 0 分"
                            : undefined;
                          return (
                            <td
                              key={col.key}
                              title={
                                isError
                                  ? errMsg
                                  : isWarn
                                    ? warnMsg
                                    : col.key === "name" && row.cosmocodeUrl.trim()
                                      ? `${raw || "—"}（双击刷新获取）`
                                      : repoInfo
                                        ? `${raw}｜${repoInfo.note}`
                                        : raw || undefined
                              }
                              onClick={
                                isEditable
                                  ? () => {
                                      if (col.key === "name") {
                                        if (nameClickTimer.current) {
                                          window.clearTimeout(nameClickTimer.current);
                                        }
                                        nameClickTimer.current = window.setTimeout(
                                          () => {
                                            nameClickTimer.current = null;
                                            setEdit({
                                              rowIndex: idx,
                                              key: "name",
                                              value: raw,
                                            });
                                          },
                                          250,
                                        );
                                      } else {
                                        setEdit({
                                          rowIndex: idx,
                                          key: col.key as PreviewEditableKey,
                                          value: raw,
                                        });
                                      }
                                    }
                                  : undefined
                              }
                              onDoubleClick={
                                col.key === "name" && row.cosmocodeUrl.trim()
                                  ? () => {
                                      if (nameClickTimer.current) {
                                        window.clearTimeout(nameClickTimer.current);
                                        nameClickTimer.current = null;
                                      }
                                      void refreshName(idx);
                                    }
                                  : undefined
                              }
                              className={`px-3 py-2 ${
                                col.nowrap
                                  ? "overflow-hidden text-ellipsis whitespace-nowrap"
                                  : "break-all"
                              } ${
                                isError
                                  ? "cursor-pointer font-medium text-rose-600 hover:bg-rose-50"
                                  : isWarn
                                    ? "cursor-pointer bg-amber-50 font-medium text-amber-700 hover:bg-amber-100"
                                    : isEditable
                                      ? "cursor-pointer text-slate-500 hover:bg-slate-50"
                                      : "text-slate-500"
                              }`}
                            >
                              {col.key === "repoUrl" ? (
                                <span className="flex items-center gap-1">
                                  {isError && <span>⚠</span>}
                                  <span className="truncate">{raw || "—"}</span>
                                  {repoInfo?.private && (
                                    <span
                                      className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600"
                                      title={repoInfo.note}
                                    >
                                      私有
                                    </span>
                                  )}
                                  {repoInfo && !repoInfo.private && (
                                    <span
                                      className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600"
                                      title={repoInfo.note}
                                    >
                                      公开
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <>
                                  {isError && <span className="mr-1">⚠</span>}
                                  {isWarn && <span className="mr-1">⚠</span>}
                                  {col.key === "name" ? (
                                    <span className="flex items-center gap-1">
                                      <span className="truncate">
                                        {raw || (
                                          <span className="text-slate-300">
                                            {row.cosmocodeUrl.trim()
                                              ? "双击刷新获取名称"
                                              : "点击填写名称"}
                                          </span>
                                        )}
                                      </span>
                                      {refreshingNameUrl === row.cosmocodeUrl.trim() && (
                                        <span className="shrink-0 animate-spin text-indigo-500">
                                          <Icon name="refresh" className="h-3.5 w-3.5" />
                                        </span>
                                      )}
                                      {raw && autoNamedUrls.has(row.cosmocodeUrl.trim()) && (
                                        <span
                                          className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"
                                          title="根据 COSMO Code 应用链接自动匹配"
                                        >
                                          自动
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    raw || "—"
                                  )}
                                </>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={calibrate}
            onChange={(e) => setCalibrate(e.target.checked)}
            disabled={running}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
          />
          <span>
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
              <Icon name="scale" className="h-4 w-4 text-slate-400" />
              全局横向校准
            </span>
            <span className="ml-2 text-xs text-slate-500">
              全部评完后在同一维度上横向比对并微调分值，保证跨应用可比（建议开启）
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            onClick={runBatch}
            disabled={!canStart}
          >
            {running && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {running
              ? calibrating
                ? "全局横向校准中…"
                : "批量评审中…"
              : `开始批量打分${rows.length ? `（${rows.length}）` : ""}`}
          </Button>
          {hasResults && items.some((i) => i.report?.calibrated) && (
            <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-600">
              已全局校准
            </span>
          )}
        </div>

        {hasResults && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>
                进度：{finished} / {items.length}
              </span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {hasResults && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <SortableHeader
                    label="应用名称"
                    sortKey="name"
                    sort={sort}
                    onSort={handleSort}
                    align="left"
                    className="px-3 py-2.5 font-medium"
                  />
                  <th className="px-3 py-2.5 text-center font-medium">赛道</th>
                  {SCORE_DIMENSIONS.map((d) => (
                    <SortableHeader
                      key={d.key}
                      label={d.name}
                      subtitle={`${d.weight}%`}
                      sortKey={d.key}
                      sort={sort}
                      onSort={handleSort}
                      className="px-3 py-2.5 font-medium"
                    />
                  ))}
                  <SortableHeader
                    label="五维分"
                    sortKey="fiveDim"
                    sort={sort}
                    onSort={handleSort}
                    className="border-l border-indigo-100 bg-indigo-50 px-3 py-2.5 font-medium text-indigo-600"
                  />
                  <SortableHeader
                    label="开源加分"
                    sortKey="openSource"
                    sort={sort}
                    onSort={handleSort}
                    className="px-3 py-2.5 font-medium"
                  />
                  <SortableHeader
                    label="定向加分"
                    sortKey="directed"
                    sort={sort}
                    onSort={handleSort}
                    className="px-3 py-2.5 font-medium"
                  />
                  <SortableHeader
                    label="综合总分"
                    sortKey="total"
                    sort={sort}
                    onSort={handleSort}
                    hoverClass="hover:text-white"
                    activeClass="text-white"
                    className="bg-indigo-600 px-3 py-2.5 font-medium text-white"
                  />
                  <th className="px-3 py-2.5 text-center font-medium">状态</th>
                  <th className="px-3 py-2.5 text-center font-medium">详情</th>
                  <th className="px-3 py-2.5 text-center font-medium">人工评价</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayItems.map((item) => {
                  const scoreByKey = new Map(
                    (item.report?.dimensions ?? []).map((d) => [d.key, d.score]),
                  );
                  const rowKey = item.id ?? item.name;
                  const isOpen = expanded.has(rowKey);
                  return (
                    <Fragment key={rowKey}>
                      <tr className="text-slate-700">
                        <td className="max-w-[200px] truncate px-3 py-2.5">
                          <div className="font-medium text-slate-800">{item.name}</div>
                          <div className="max-w-[200px] truncate text-xs text-slate-400">
                            {item.topic}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{item.track || "—"}</td>
                        {SCORE_DIMENSIONS.map((d) => {
                          const value = scoreByKey.get(d.key);
                          return (
                            <td key={d.key} className="px-3 py-2.5 text-center">
                              {value === undefined || value === null ? (
                                <span
                                  className="text-xs text-slate-400"
                                  title="该维度暂不自动评分，留待人工评分"
                                >
                                  待评
                                </span>
                              ) : (
                                <span className="font-semibold text-slate-700">{value}</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="border-l border-indigo-100 bg-indigo-50/60 px-3 py-2.5 text-center">
                          {item.report ? (
                            <span className="font-semibold text-slate-700">
                              {Math.round(item.report.fiveDimScore)}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {item.report ? (
                            <span className="font-semibold text-emerald-600">
                              +{item.report.openSourceBonus}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {item.report ? (
                            <span className="font-semibold text-violet-600">
                              +{item.report.directedTopicBonus}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="bg-indigo-600 px-3 py-2.5 text-center">
                          {item.report ? (
                            <div>
                              <span
                                className={`text-base font-bold ${
                                  item.report.disqualified
                                    ? "text-rose-200"
                                    : "text-white"
                                }`}
                              >
                                {Math.round(item.report.total)}
                              </span>
                              <TopicFlag check={item.report.directedTopicCheck} />
                              {item.report.disqualified && (
                                <div className="text-[10px] leading-tight text-rose-100">
                                  应用链接无效
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-indigo-200">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">{statusBadge(item.status)}</td>
                        <td className="px-3 py-2.5 text-center">
                          {(item.report || item.error) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => toggleExpand(rowKey)}
                            >
                              {isOpen ? "收起" : "查看"}
                            </Button>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center align-top">
                          {item.id && (
                            <CommentCell
                              value={item.comment}
                              onCommit={(comment) =>
                                void handleCommentChange(item.id as string, comment)
                              }
                            />
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={SCORE_DIMENSIONS.length + 9} className="px-4 py-3">
                            {item.error && (
                              <p className="text-sm text-rose-600">{item.error}</p>
                            )}
                            {item.report && (
                              <div className="space-y-2">
                                <p className="text-sm text-slate-600">{item.report.summary}</p>
                                {item.report.sources && item.report.sources.length > 0 && (
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                    {item.report.sources.map((s) => (
                                      <span key={s.key} className="flex items-center gap-1">
                                        <span className={s.ok ? "text-emerald-500" : "text-slate-300"}>
                                          {s.ok ? "●" : "○"}
                                        </span>
                                        {s.label}
                                        <span className="text-slate-400">
                                          {s.ok
                                            ? `已读取 ${s.chars} 字${s.note ? `（${s.note}）` : ""}`
                                            : s.note}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                )}
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
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasResults && (
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => exportResultsCsv(items, SCORE_DIMENSIONS)}
          >
            <Icon name="download" className="h-4 w-4" />
            导出结果 CSV
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={handlePoster}>
            <Icon name="chart" className="h-4 w-4" />
            生成排序海报
          </Button>
        </div>
      )}

      {edit &&
        (() => {
          const isName = edit.key === "name";
          const rule = isName
            ? undefined
            : LINK_RULES.find((r) => r.key === edit.key);
          const check = isName
            ? ({ status: "ok", message: "" } as const)
            : validateLink(edit.key as LinkKey, edit.value);
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={() => setEdit(null)}
            >
              <div
                className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-base font-semibold text-slate-800">
                  修改「{isName ? "应用名称" : rule?.label}」
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {isName
                    ? "留空将根据 COSMO Code 应用链接自动匹配；手动填写的名称在批量评分时优先使用"
                    : `参考格式：${rule?.hint}`}
                </p>
                <input
                  autoFocus
                  value={edit.value}
                  onChange={(e) =>
                    setEdit((prev) => (prev ? { ...prev, value: e.target.value } : prev))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyEdit();
                    if (e.key === "Escape") setEdit(null);
                  }}
                  placeholder={isName ? "请输入应用名称" : rule?.hint}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
                {!isName && (
                  <p
                    className={`mt-2 text-xs ${
                      check.status === "ok"
                        ? "text-emerald-600"
                        : check.status === "error"
                          ? "text-rose-600"
                          : "text-slate-400"
                    }`}
                  >
                    {check.status === "ok" ? "✓ 格式正确" : check.message}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-slate-400">
                  修改需点击「确认修改」后生效
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setEdit(null)}
                  >
                    取消
                  </Button>
                  <Button type="button" onClick={applyEdit}>
                    确认修改
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
