import type { ReviewDecision } from "@/types";

export interface ReviewDecisionOption {
  value: ReviewDecision;
  label: string;
  active: string;
  weight: number;
}

export const REVIEW_DECISIONS: ReviewDecisionOption[] = [
  {
    value: "advance",
    label: "晋级",
    active: "border-emerald-300 bg-emerald-100 text-emerald-700",
    weight: 0,
  },
  {
    value: "hold",
    label: "待定",
    active: "border-amber-300 bg-amber-100 text-amber-700",
    weight: 1,
  },
  {
    value: "out",
    label: "淘汰",
    active: "border-slate-300 bg-slate-200 text-slate-600",
    weight: 2,
  },
];

export function decisionLabel(decision?: ReviewDecision): string {
  return REVIEW_DECISIONS.find((d) => d.value === decision)?.label ?? "";
}

export function decisionWeight(decision?: ReviewDecision): number {
  return decision
    ? REVIEW_DECISIONS.find((d) => d.value === decision)?.weight ?? 3
    : 3;
}
