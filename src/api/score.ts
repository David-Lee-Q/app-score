import type { ScoreDimension, ScoreReport, ScoreRequest } from "@/types";

export async function requestScore(payload: ScoreRequest): Promise<ScoreReport> {
  const res = await fetch("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `评分失败（HTTP ${res.status}）`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (await res.json()) as ScoreReport;
}

export interface CalibrateItem {
  index: number;
  name: string;
  topic: string;
  summary: string;
  dimensions: { key: string; name: string; score: number }[];
}

export interface CalibrateResult {
  index: number;
  dimensions: { key: string; score: number }[];
}

export async function requestCalibrate(
  dimensions: ScoreDimension[],
  items: CalibrateItem[],
): Promise<CalibrateResult[]> {
  const res = await fetch("/api/calibrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dimensions, items }),
  });

  if (!res.ok) {
    let message = `校准失败（HTTP ${res.status}）`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const data = (await res.json()) as { items?: CalibrateResult[] };
  return Array.isArray(data.items) ? data.items : [];
}

export interface RepoAccess {
  accessible: boolean;
  private: boolean;
  status: number;
  note: string;
}

export interface NameResolution {
  name: string;
  status: number;
  note: string;
}

export async function resolveAppNames(
  urls: string[],
): Promise<Record<string, NameResolution>> {
  if (!urls.length) return {};
  const res = await fetch("/api/resolve-names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) {
    throw new Error(`应用名称匹配失败（HTTP ${res.status}）`);
  }
  const data = (await res.json()) as { results?: Record<string, NameResolution> };
  return data.results ?? {};
}

export async function checkRepos(urls: string[]): Promise<Record<string, RepoAccess>> {
  if (!urls.length) return {};
  const res = await fetch("/api/check-repos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) {
    throw new Error(`代码仓可访问性检测失败（HTTP ${res.status}）`);
  }
  const data = (await res.json()) as { results?: Record<string, RepoAccess> };
  return data.results ?? {};
}
