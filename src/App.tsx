import { useState } from "react";
import { requestScore, resolveAppNames } from "@/api/score";
import { SCORE_DIMENSIONS, DIMENSION_MAX_SCORE } from "@/config/dimensions";
import { BUILT_IN_TOPICS } from "@/config/topics";
import { TRACKS } from "@/config/tracks";
import { APP_VERSION, CHANGELOG } from "@/config/changelog";
import type { ScoreMeta, ScoreReport } from "@/types";
import ScoreResult from "@/components/ScoreResult";
import BatchScorer from "@/components/BatchScorer";
import HistoryPanel from "@/components/HistoryPanel";
import Button from "@/components/Button";
import { Icon, type IconName } from "@/components/icons";
import { newHistoryId, saveHistory } from "@/utils/history";
import { validateLink } from "@/utils/validate";

type Mode = "single" | "batch" | "history";

const MODES: { key: Mode; label: string }[] = [
  { key: "single", label: "单个评分" },
  { key: "batch", label: "批量评分" },
  { key: "history", label: "评分历史" },
];

export default function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [showChangelog, setShowChangelog] = useState(false);

  return (
    <div className="flex min-h-full flex-col bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="grid w-full grid-cols-1 items-center gap-x-6 px-4 sm:grid-cols-[1fr_auto_1fr] sm:px-5 lg:px-6">
          <div className="flex items-center gap-3 pt-3 justify-self-start sm:py-3 sm:pt-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-lg font-bold text-white shadow">
              预
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">智能应用预审打分系统</h1>
              <p className="text-xs text-slate-500">
                录入申报信息，自动输出 {SCORE_DIMENSIONS.length} 个维度评分
              </p>
            </div>
          </div>

          <nav
            aria-label="主导航"
            className="flex items-stretch justify-center gap-1 justify-self-center pb-1 sm:pb-0"
          >
            {MODES.map((tab) => {
              const active = mode === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setMode(tab.key)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center px-3 py-2.5 text-sm font-bold transition sm:px-5 sm:py-0 ${
                    active
                      ? "text-indigo-600"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full transition ${
                      active ? "bg-indigo-600" : "bg-transparent"
                    }`}
                  />
                </button>
              );
            })}
          </nav>

          <div aria-hidden="true" className="hidden sm:block" />
        </div>
      </header>

      <main className="w-full flex-1 space-y-6 px-4 py-6 sm:px-5 sm:py-8 lg:px-6">
        {mode === "single" ? (
          <SingleScorer />
        ) : mode === "batch" ? (
          <BatchScorer />
        ) : (
          <HistoryPanel />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white/60">
        <div className="w-full px-4 py-6 text-xs text-slate-400 sm:px-5 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>智能应用预审打分系统 · 当前版本 {APP_VERSION}</span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setShowChangelog((v) => !v)}
            >
              版本记录
              <span className={`transition ${showChangelog ? "rotate-180" : ""}`}>▾</span>
            </Button>
          </div>
          {showChangelog && (
            <ol className="mt-3 space-y-3 border-t border-slate-100 pt-3">
              {CHANGELOG.map((entry) => (
                <li key={entry.version}>
                  <div className="flex items-center gap-2 text-slate-500">
                    <span className="rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-600">
                      {entry.version}
                    </span>
                    <span>{entry.date}</span>
                  </div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-400">
                    {entry.changes.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      </footer>
    </div>
  );
}

const EMPTY_FORM = {
  name: "",
  track: "",
  topic: "",
  cosmocodeUrl: "",
  openlabUrl: "",
  repoUrl: "",
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

function SingleScorer() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ScoreReport | null>(null);
  const [appLinkWarn, setAppLinkWarn] = useState("");
  const [autoName, setAutoName] = useState("");

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === "cosmocodeUrl") setAppLinkWarn("");
  }

  async function checkAppLink(value: string) {
    const url = value.trim();
    setAppLinkWarn("");
    if (!url || validateLink("cosmocodeUrl", url).status !== "ok") return;
    try {
      const res = await resolveAppNames([url]);
      const info = res[url];
      if (info && (info.status === 0 || info.status >= 400)) {
        setAppLinkWarn(
          info.status
            ? `应用链接不可访问（HTTP ${info.status}），将直接计 0 分`
            : "应用链接无法访问，将直接计 0 分",
        );
      }
      if (info?.name) {
        setAutoName(info.name);
        setForm((prev) => (prev.name.trim() ? prev : { ...prev, name: info.name }));
      }
    } catch {
      // 忽略检测失败
    }
  }

  const hasLink =
    !!form.cosmocodeUrl.trim() ||
    !!form.openlabUrl.trim() ||
    !!form.repoUrl.trim();
  const canSubmit = !!form.topic && !!form.track && hasLink && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError("");
    setReport(null);

    const meta: ScoreMeta = {
      name: form.name.trim(),
      track: form.track,
      topic: form.topic,
      cosmocodeUrl: form.cosmocodeUrl.trim(),
      openlabUrl: form.openlabUrl.trim(),
      repoUrl: form.repoUrl.trim(),
    };

    try {
      const result = await requestScore({
        ...meta,
        dimensions: SCORE_DIMENSIONS,
      });
      setReport(result);
      void saveHistory({
        id: newHistoryId(),
        kind: "single",
        createdAt: new Date().toISOString(),
        title: form.name.trim() || form.topic,
        subtitle: form.track,
        total: result.total,
        calibrated: Boolean(result.calibrated),
        dimensions: SCORE_DIMENSIONS,
        single: { meta, report: result },
      }).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : "评分失败，请稍后重试";
      setError(message);
      void saveHistory({
        id: newHistoryId(),
        kind: "single",
        createdAt: new Date().toISOString(),
        title: form.name.trim() || form.topic,
        subtitle: form.track,
        dimensions: SCORE_DIMENSIONS,
        single: { meta, error: message },
      }).catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
      >
        <div>
          <label
            htmlFor="name"
            className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700"
          >
            <Icon name="app" className="h-4 w-4 text-slate-400" />
            应用名称（选填）
            {autoName && form.name === autoName && (
              <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                根据应用链接自动匹配
              </span>
            )}
          </label>
          <input
            id="name"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="用于区分应用，可留空（将根据应用链接自动匹配）"
            className={inputClass}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="track"
              className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700"
            >
              <Icon name="flag" className="h-4 w-4 text-slate-400" />
              赛道
            </label>
            <select
              id="track"
              required
              value={form.track}
              onChange={(e) => update("track", e.target.value)}
              className={`${inputClass} bg-white`}
            >
              <option value="">请选择赛道</option>
              {TRACKS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="topic"
              className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700"
            >
              <Icon name="target" className="h-4 w-4 text-slate-400" />
              赛题
            </label>
            <select
              id="topic"
              required
              value={form.topic}
              onChange={(e) => update("topic", e.target.value)}
              className={`${inputClass} bg-white`}
            >
              <option value="">请选择赛题</option>
              {BUILT_IN_TOPICS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4">
          <LinkField
            id="cosmocodeUrl"
            label="COSMO Code 应用链接"
            icon="link"
            value={form.cosmocodeUrl}
            onChange={(v) => update("cosmocodeUrl", v)}
            onBlur={() => void checkAppLink(form.cosmocodeUrl)}
            placeholder="https://..."
            className={inputClass}
            warning={appLinkWarn}
          />
          <LinkField
            id="openlabUrl"
            label="OpenLab 文章链接"
            icon="article"
            value={form.openlabUrl}
            onChange={(v) => update("openlabUrl", v)}
            placeholder="https://..."
            className={inputClass}
          />
          <LinkField
            id="repoUrl"
            label="开源代码仓"
            icon="code"
            value={form.repoUrl}
            onChange={(v) => update("repoUrl", v)}
            placeholder="https://github.com/..."
            className={inputClass}
          />
        </div>

        <p className="text-xs text-slate-400">
          以上三个链接至少填写一个，系统将抓取链接内容作为评审依据
        </p>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <p className="bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
            评分维度（各项满分 {DIMENSION_MAX_SCORE} 分，按权重加权为五维加权分，满分 100）
          </p>
          <table className="w-full min-w-[520px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-y border-slate-200 bg-white text-slate-500">
                <th className="px-4 py-2 font-medium">维度</th>
                <th className="px-4 py-2 text-center font-medium">权重</th>
                <th className="px-4 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {SCORE_DIMENSIONS.map((d) => (
                <tr key={d.key} className="text-slate-600">
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-700">
                    {d.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-center text-slate-500">
                    {d.weight}%
                  </td>
                  <td className="px-4 py-2.5 leading-relaxed">{d.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs leading-relaxed text-slate-500">
            总分 = 五维加权分 + 开源加分（填写开源代码仓且可公开访问，+5）+ 定向揭榜赛题加分（参选前三个赛题，+10），满分 115。「COSMO Code 使用深度」暂不自动评分，留待人工评分。
          </p>
        </div>

        <div className="flex justify-center">
          <Button type="submit" disabled={!canSubmit}>
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                正在评审中…
              </>
            ) : (
              "开始打分"
            )}
          </Button>
        </div>
      </form>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      )}

      {report && <ScoreResult report={report} />}
    </div>
  );
}

function LinkField({
  id,
  label,
  icon,
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  warning,
}: {
  id: string;
  label: string;
  icon: IconName;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder: string;
  className: string;
  warning?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700"
      >
        <Icon name={icon} className="h-4 w-4 text-slate-400" />
        {label}
      </label>
      <input
        id={id}
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={className}
      />
      {warning && (
        <p className="mt-1.5 text-xs font-medium text-amber-600">⚠ {warning}</p>
      )}
    </div>
  );
}
