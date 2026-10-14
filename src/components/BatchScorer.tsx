import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  checkRepos,
  requestCalibrate,
  requestScore,
  resolveAppNames,
  type RepoAccess,
} from "@/api/score";
import Button from "@/components/Button";
import { SCORE_DIMENSIONS } from "@/config/dimensions";
import type { ApplicationRow, BatchItemResult, HistoryEntry, ScoreReport } from "@/types";
import {
  downloadTemplate,
  exportResultsCsv,
  parseApplicationsFile,
} from "@/utils/spreadsheet";
import { weightedFiveDim } from "@/utils/score";
import { newHistoryId, saveHistory } from "@/utils/history";
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
    batch: { items, fileName },
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
      scoreByKey.has(d.key) ? { ...d, score: scoreByKey.get(d.key) as number } : d,
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

const PREVIEW_COLUMNS = [
  { key: "name", label: "应用名称（选填）", width: 150, nowrap: true },
  { key: "track", label: "赛道", width: 100, nowrap: true },
  { key: "topic", label: "赛题", width: 220, nowrap: true },
  { key: "cosmocodeUrl", label: "COSMO Code应用链接", width: 260, nowrap: true },
  { key: "openlabUrl", label: "OpenLab文章链接", width: 260, nowrap: true },
  { key: "repoUrl", label: "开源代码仓", width: 260, nowrap: true },
] as const;

const MIN_COL_WIDTH = 80;

export default function BatchScorer() {
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<BatchItemResult[]>([]);
  const [running, setRunning] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrate, setCalibrate] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [edit, setEdit] = useState<{
    rowIndex: number;
    key: LinkKey;
    value: string;
  } | null>(null);
  const [colWidths, setColWidths] = useState<number[]>(
    PREVIEW_COLUMNS.map((c) => c.width),
  );
  const [repoAccess, setRepoAccess] = useState<Record<string, RepoAccess>>({});
  const [checkingRepos, setCheckingRepos] = useState(false);
  const [autoNamedUrls, setAutoNamedUrls] = useState<Set<string>>(new Set());
  const attemptedNames = useRef<Set<string>>(new Set());
  const [resolvingNames, setResolvingNames] = useState(false);
  const dragRef = useRef<{ index: number; startX: number; startWidth: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const pending = [
      ...new Set(
        rows
          .filter(
            (r) =>
              !r.name.trim() &&
              r.cosmocodeUrl.trim() &&
              validateLink("cosmocodeUrl", r.cosmocodeUrl).status === "ok",
          )
          .map((r) => r.cosmocodeUrl.trim())
          .filter((u) => !attemptedNames.current.has(u)),
      ),
    ];
    if (!pending.length) return;
    pending.forEach((u) => attemptedNames.current.add(u));
    let cancelled = false;
    setResolvingNames(true);
    resolveAppNames(pending)
      .then((results) => {
        if (cancelled) return;
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
    setEdit(null);
  }

  async function handleFile(file: File) {
    setError("");
    setItems([]);
    setExpanded(new Set());
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

    const results: BatchItemResult[] = rows.map((r) => ({
      ...r,
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
    void saveHistory(buildBatchHistory(results, fileName)).catch(() => {});
  }

  function toggleExpand(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const hasResults = items.length > 0;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">批量待评分应用</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              下载模板 → 填写多个应用 → 上传 → 一键批量打分
            </p>
          </div>
          <Button type="button" variant="soft" size="sm" onClick={downloadTemplate}>
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
              共 {rows.length} 条 · 全部模板字段预览 · 各字段单行展示，超宽以「…」省略（悬停可见完整内容）· 拖拽列标题右边界可调整列宽
            </p>
            <p className="mb-1.5 text-xs text-slate-400">
              链接格式校验：
              {invalidLinkCount > 0 ? (
                <span className="text-rose-600">
                  {invalidLinkCount} 个链接有误（红色标记），点击单元格可修改，需确认后生效；COSMO Code应用链接无效或未填将直接计 0 分
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
                        <span className="block truncate">{col.label}</span>
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
                          const check = isLink ? validateLink(col.key, raw) : null;
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
                          return (
                            <td
                              key={col.key}
                              title={
                                isError
                                  ? errMsg
                                  : repoInfo
                                    ? `${raw}｜${repoInfo.note}`
                                    : raw || undefined
                              }
                              onClick={
                                isLink
                                  ? () =>
                                      setEdit({
                                        rowIndex: idx,
                                        key: col.key as LinkKey,
                                        value: raw,
                                      })
                                  : undefined
                              }
                              className={`px-3 py-2 ${
                                col.nowrap
                                  ? "overflow-hidden text-ellipsis whitespace-nowrap"
                                  : "break-all"
                              } ${
                                isError
                                  ? "cursor-pointer font-medium text-rose-600 hover:bg-rose-50"
                                  : isLink
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
                                  {col.key === "name" ? (
                                    <span className="flex items-center gap-1">
                                      <span className="truncate">{raw}</span>
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
            <span className="font-medium text-slate-700">全局横向校准</span>
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
                  <th className="px-3 py-2.5 font-medium">应用名称</th>
                  <th className="px-3 py-2.5 font-medium">赛道</th>
                  {SCORE_DIMENSIONS.map((d) => (
                    <th key={d.key} className="px-3 py-2.5 text-center font-medium">
                      {d.name}
                      <span className="block text-[10px] font-normal text-slate-400">
                        {d.weight}%
                      </span>
                    </th>
                  ))}
                  <th className="border-l border-indigo-100 bg-indigo-50 px-3 py-2.5 text-center font-medium text-indigo-600">
                    五维分
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium">开源加分</th>
                  <th className="px-3 py-2.5 text-center font-medium">定向加分</th>
                  <th className="bg-indigo-600 px-3 py-2.5 text-center font-medium text-white">
                    综合总分
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium">状态</th>
                  <th className="px-3 py-2.5 text-center font-medium">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, idx) => {
                  const scoreByKey = new Map(
                    (item.report?.dimensions ?? []).map((d) => [d.key, d.score]),
                  );
                  const isOpen = expanded.has(idx);
                  return (
                    <Fragment key={idx}>
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
                              {value === undefined ? (
                                <span className="text-slate-300">—</span>
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
                              onClick={() => toggleExpand(idx)}
                            >
                              {isOpen ? "收起" : "查看"}
                            </Button>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={SCORE_DIMENSIONS.length + 8} className="px-4 py-3">
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
                                          {d.score}
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
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => exportResultsCsv(items, SCORE_DIMENSIONS)}
          >
            导出结果 CSV
          </Button>
        </div>
      )}

      {edit &&
        (() => {
          const rule = LINK_RULES.find((r) => r.key === edit.key);
          const check = validateLink(edit.key, edit.value);
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
                  修改「{rule?.label}」
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  参考格式：{rule?.hint}
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
                  placeholder={rule?.hint}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
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
