export const BUILT_IN_TOPICS: string[] = [
  "基于多智能应用协同的高效换产",
  "空压站多机协同智能调度智能应用",
  "离散制造·结构件「智图智构」",
  "设备智能管理与预测性维护智能应用",
  "质量缺陷分析与归因智能应用",
  "企业经营数据对话分析智能应用",
  "AI智能客服与营销转化应用",
  "智能应用创新",
];

export function matchBuiltInTopic(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const exact = BUILT_IN_TOPICS.find((t) => t === value);
  if (exact) return exact;
  const contains = BUILT_IN_TOPICS.find(
    (t) => value.includes(t) || t.includes(value),
  );
  return contains ?? "";
}

export const DIRECTED_TOPICS: string[] = BUILT_IN_TOPICS.slice(0, 3);

export function isDirectedTopic(topic: string): boolean {
  return DIRECTED_TOPICS.includes(topic.trim());
}

export const OPEN_SOURCE_BONUS = 5;
export const DIRECTED_TOPIC_BONUS = 10;

