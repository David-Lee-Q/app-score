import { useCallback, useEffect, useState } from "react";
import type { HistoryEntry } from "@/types";
import ScoreResult from "@/components/ScoreResult";
import Button from "@/components/Button";
import { exportResultsCsv, exportSingleResultCsv } from "@/utils/spreadsheet";
import { deleteHistory, fetchHistory } from "@/utils/history";

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

function BatchTable({ entry }: { entry: HistoryEntry }) {
  const items = entry.batch?.items ?? [];
  const dimensions = entry.dimensions;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">应用名称</th>
            <th className="px-3 py-2 font-medium">赛道</th>
            {dimensions.map((d) => (
              <th key={d.key} className="px-3 py-2 text-center font-medium">
                {d.name}
                <span className="block text-[10px] font-normal text-slate-400">
                  {d.weight}%
                </span>
              </th>
            ))}
            <th className="px-3 py-2 text-center font-medium">开源加分</th>
            <th className="px-3 py-2 text-center font-medium">定向加分</th>
            <th className="px-3 py-2 text-center font-medium">综合总分</th>
            <th className="px-3 py-2 text-center font-medium">状态</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item, idx) => {
            const scoreByKey = new Map(
              (item.report?.dimensions ?? []).map((d) => [d.key, d.score]),
            );
            return (
              <tr key={idx} className="text-slate-700">
                <td className="max-w-[200px] truncate px-3 py-2">
                  <div className="font-medium text-slate-800">{item.name}</div>
                  <div className="truncate text-xs text-slate-400">{item.topic}</div>
                </td>
                <td className="px-3 py-2 text-slate-500">{item.track || "—"}</td>
                {dimensions.map((d) => (
                  <td key={d.key} className="px-3 py-2 text-center">
                    {scoreByKey.has(d.key) ? (
                      scoreByKey.get(d.key)
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-center font-semibold text-emerald-600">
                  {item.report ? `+${item.report.openSourceBonus}` : "—"}
                </td>
                <td className="px-3 py-2 text-center font-semibold text-violet-600">
                  {item.report ? `+${item.report.directedTopicBonus}` : "—"}
                </td>
                <td className="px-3 py-2 text-center font-bold text-indigo-600">
                  {item.report ? Math.round(item.report.total) : "—"}
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

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

  async function handleDelete(id: string) {
    if (!window.confirm("确定删除该条评分历史？")) return;
    try {
      await deleteHistory(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (openId === id) setOpenId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  function handleDownload(entry: HistoryEntry) {
    if (entry.kind === "single" && entry.single) {
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

  const hasDownloadable = (entry: HistoryEntry) =>
    (entry.kind === "single" && !!entry.single) ||
    (entry.kind === "batch" && !!entry.batch && (entry.batch.items?.length ?? 0) > 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
                    {hasDownloadable(entry) && (
                      <Button
                        type="button"
                        variant="soft"
                        size="xs"
                        onClick={() => handleDownload(entry)}
                      >
                        下载
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="danger"
                      size="xs"
                      onClick={() => void handleDelete(entry.id)}
                    >
                      删除
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                    {entry.kind === "single" && entry.single ? (
                      <ScoreResult report={entry.single.report} />
                    ) : (
                      <BatchTable entry={entry} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
