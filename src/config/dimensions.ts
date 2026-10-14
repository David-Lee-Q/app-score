import type { ScoreDimension } from "@/types";

export const SCORE_DIMENSIONS: ScoreDimension[] = [
  {
    key: "creativity",
    name: "创意度",
    weight: 20,
    description: "场景切入点是否新颖，是否有独到见解，是否有创新性。",
  },
  {
    key: "completeness",
    name: "完整度",
    weight: 25,
    description: "功能是否完整可用，核心流程是否跑通，非仅停留在概念。",
  },
  {
    key: "value",
    name: "场景价值",
    weight: 25,
    description: "是否解决真实痛点，是否有推广价值，工业/商业/社会价值。",
  },
  {
    key: "design",
    name: "设计打磨",
    weight: 10,
    description: "交互体验、界面完成度、细节处理。",
  },
  {
    key: "cosmoUsage",
    name: "COSMO Code使用深度",
    weight: 20,
    description:
      "通过作品说明文章中的开发过程截图和 COSMO Code 对话记录，核验作品是否真实使用平台开发；是否有多轮对话迭代，是否有效利用平台能力而非纯外部代码。",
  },
];

export const DIMENSION_MAX_SCORE = 100;

export const TOTAL_WEIGHT = SCORE_DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);
