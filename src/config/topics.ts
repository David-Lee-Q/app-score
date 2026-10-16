export const BUILT_IN_TOPICS: string[] = [
  "基于多智能体协同的高效换产",
  "空压站多机协同智能调度 Agent",
  "离散制造结构件图纸解析智能应用",
  "设备智能管理与预测性维护智能应用",
  "质量缺陷分析与归因智能应用",
  "企业经营数据对话分析智能应用",
  "AI 智能客服与营销转化应用",
  "智能应用创新",
];

export const TOPIC_ALIASES: Record<string, string> = {
  "基于多智能应用协同的高效换产": "基于多智能体协同的高效换产",
  "空压站多机协同智能调度智能应用": "空压站多机协同智能调度 Agent",
  "AI智能客服与营销转化应用": "AI 智能客服与营销转化应用",
};

function compact(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function matchBuiltInTopic(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const exact = BUILT_IN_TOPICS.find((t) => t === value);
  if (exact) return exact;
  const key = compact(value);
  if (!key) return "";
  const compactExact = BUILT_IN_TOPICS.find((t) => compact(t) === key);
  if (compactExact) return compactExact;
  if (TOPIC_ALIASES[value]) return TOPIC_ALIASES[value];
  const aliasKey = Object.keys(TOPIC_ALIASES).find((k) => compact(k) === key);
  if (aliasKey) return TOPIC_ALIASES[aliasKey];
  const contains = BUILT_IN_TOPICS.find((t) => {
    const tc = compact(t);
    return value.includes(t) || t.includes(value) || key.includes(tc) || tc.includes(key);
  });
  return contains ?? "";
}

export const DIRECTED_TOPICS: string[] = BUILT_IN_TOPICS.slice(0, 3);

export function isDirectedTopic(topic: string): boolean {
  return DIRECTED_TOPICS.includes(topic.trim());
}

export const OPEN_SOURCE_BONUS = 5;
export const DIRECTED_TOPIC_BONUS = 10;
