export interface ScoreDimension {
  key: string;
  name: string;
  weight: number;
  description: string;
}

export interface DimensionScore {
  key: string;
  name: string;
  weight: number;
  score: number;
  reason: string;
}

export interface SourceInfo {
  key: string;
  label: string;
  url: string;
  ok: boolean;
  chars: number;
  note: string;
}

export interface ScoreReport {
  total: number;
  fiveDimScore: number;
  openSourceBonus: number;
  directedTopicBonus: number;
  openSourceReason?: string;
  dimensions: DimensionScore[];
  summary: string;
  mode: "llm" | "mock";
  model?: string;
  sources?: SourceInfo[];
  calibrated?: boolean;
  disqualified?: boolean;
  generatedAt: string;
}

export interface ApplicationInput {
  track: string;
  topic: string;
  cosmocodeUrl: string;
  openlabUrl: string;
  repoUrl: string;
}

export interface ScoreRequest extends ApplicationInput {
  name?: string;
  dimensions: ScoreDimension[];
}

export interface ApplicationRow extends ApplicationInput {
  name: string;
}

export type BatchItemStatus = "pending" | "scoring" | "done" | "error";

export interface BatchItemResult extends ApplicationRow {
  status: BatchItemStatus;
  report?: ScoreReport;
  error?: string;
}

export interface ScoreMeta {
  name: string;
  track: string;
  topic: string;
  cosmocodeUrl: string;
  openlabUrl: string;
  repoUrl: string;
}

export interface HistoryEntry {
  id: string;
  kind: "single" | "batch";
  createdAt: string;
  title: string;
  subtitle?: string;
  total?: number;
  calibrated?: boolean;
  dimensions: ScoreDimension[];
  single?: { meta: ScoreMeta; report: ScoreReport };
  batch?: { items: BatchItemResult[]; fileName?: string };
}
