import type { ScoreReport } from "@/types";
import { DIMENSION_MAX_SCORE } from "@/config/dimensions";

function tone(score: number) {
  if (score >= 85) return { text: "text-emerald-600", bar: "bg-emerald-500" };
  if (score >= 70) return { text: "text-blue-600", bar: "bg-blue-500" };
  if (score >= 60) return { text: "text-amber-600", bar: "bg-amber-500" };
  return { text: "text-rose-600", bar: "bg-rose-500" };
}

function Gauge({
  value,
  max = DIMENSION_MAX_SCORE,
  label = "加权总分",
}: {
  value: number;
  max?: number;
  label?: string;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(max, value));
  const offset = circumference - (clamped / max) * circumference;
  const t = tone((clamped / max) * 100);

  return (
    <div className="relative h-36 w-36">
      <svg className="h-36 w-36 -rotate-90" viewBox="0 0 128 128">
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="12"
        />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={t.text.replace("text-", "stroke-")}
          style={{ transition: "stroke-dashoffset 0.7s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-bold ${t.text}`}>{Math.round(clamped)}</span>
        <span className="text-xs text-slate-400">{label}</span>
      </div>
    </div>
  );
}

const TOTAL_MAX = DIMENSION_MAX_SCORE + 5 + 10;

function Metric({
  label,
  value,
  suffix,
  highlight = false,
}: {
  label: string;
  value: string;
  suffix: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 text-center ${
        highlight
          ? "border-indigo-200 bg-indigo-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`mt-1 text-xl font-bold ${
          highlight ? "text-indigo-600" : "text-slate-700"
        }`}
      >
        {value}
        <span className="text-xs font-normal text-slate-400"> {suffix}</span>
      </div>
    </div>
  );
}

export default function ScoreResult({ report }: { report: ScoreReport }) {
  return (
    <section className="space-y-6">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
        <Gauge value={report.total} max={TOTAL_MAX} label="综合总分" />
        <div className="flex-1 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <h2 className="text-xl font-semibold text-slate-800">综合评估结果</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                report.mode === "llm"
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {report.mode === "llm" ? `大模型评分${report.model ? ` · ${report.model}` : ""}` : "演示数据"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{report.summary}</p>
          <p className="mt-3 text-xs text-slate-400">
            生成时间：{new Date(report.generatedAt).toLocaleString("zh-CN")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="五维加权分" value={String(Math.round(report.fiveDimScore))} suffix="/ 100" />
        <Metric label="开源加分" value={`+${report.openSourceBonus}`} suffix="/ 5" />
        <Metric label="定向揭榜赛题加分" value={`+${report.directedTopicBonus}`} suffix="/ 10" />
        <Metric label="综合总分" value={String(Math.round(report.total))} suffix="/ 115" highlight />
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        总分 = 五维加权分（满分 100）+ 开源加分（共享开源代码仓且代码与参赛作品一致，最高 5；GitHub 代码仓不加分）+ 定向揭榜赛题加分（参选前三个赛题，10）。
        {report.openSourceReason ? ` 开源判定：${report.openSourceReason}` : ""}
      </p>

      {report.sources && report.sources.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            评审依据（链接抓取情况）
          </h3>
          <ul className="space-y-2">
            {report.sources.map((s) => (
              <li key={s.key} className="flex items-start gap-2 text-xs">
                <span className={s.ok ? "text-emerald-500" : "text-slate-300"}>
                  {s.ok ? "●" : "○"}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-700">{s.label}</span>
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 break-all text-indigo-600 hover:underline"
                    >
                      {s.url}
                    </a>
                  ) : (
                    <span className="ml-2 text-slate-400">未填写</span>
                  )}
                  <span className="ml-2 text-slate-400">
                    {s.ok
                      ? `已读取 ${s.chars} 字${s.note ? `（${s.note}）` : ""}`
                      : s.note}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <th className="px-4 py-3 font-medium">评分维度</th>
              <th className="px-4 py-3 text-center font-medium">权重</th>
              <th className="px-4 py-3 text-center font-medium">得分</th>
              <th className="w-1/2 px-4 py-3 font-medium">评分理由</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.dimensions.map((d) => {
              const t = tone(d.score);
              return (
                <tr key={d.key} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                    {d.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-center text-slate-500">
                    {d.weight}%
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-center">
                    <span className={`text-lg font-bold ${t.text}`}>
                      {Math.round(d.score)}
                    </span>
                    <span className="text-xs font-normal text-slate-400">
                      {" "}
                      / {DIMENSION_MAX_SCORE}
                    </span>
                    <div className="mx-auto mt-1.5 h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${t.bar}`}
                        style={{
                          width: `${Math.max(0, Math.min(100, d.score))}%`,
                          transition: "width 0.7s ease",
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 leading-relaxed text-slate-600">
                    {d.reason}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
