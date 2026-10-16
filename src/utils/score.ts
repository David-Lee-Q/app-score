export interface WeightedItem {
  weight: number;
  score: number | null;
}

function val(score: number | null | undefined): number {
  return Number.isFinite(Number(score)) ? Number(score) : 0;
}

export function weightedFiveDim(items: WeightedItem[]): number {
  if (items.length === 0) return 0;
  const totalWeight = items.reduce(
    (sum, d) => sum + (Number(d.weight) > 0 ? Number(d.weight) : 0),
    0,
  );
  if (totalWeight <= 0) {
    return Math.round(items.reduce((sum, d) => sum + val(d.score), 0) / items.length);
  }
  return Math.round(
    items.reduce((sum, d) => sum + val(d.score) * (Number(d.weight) || 0), 0) / totalWeight,
  );
}
