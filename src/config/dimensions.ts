import type { ScoreDimension } from "@/types";

export const SCORE_DIMENSIONS: ScoreDimension[] = [
  {
    key: "creativity",
    name: "创意度",
    weight: 20,
    description:
      "创新性与差异化优势：方案在技术思路、AI 能力运用与场景切入上的新颖程度，相对行业现有方案的差异化优势，以及解决赛题痛点的独到设计。",
  },
  {
    key: "completeness",
    name: "完整度",
    weight: 25,
    description:
      "功能与闭环完整度：核心功能是否完整可用、关键流程是否跑通闭环，是否覆盖赛题任务目标与要求的模块，而非停留在概念或演示。",
  },
  {
    key: "value",
    name: "场景价值",
    weight: 25,
    description:
      "场景价值与落地性：是否解决赛题真实痛点，是否有可验证的指标达成或效果数据，以及在同类场景的推广与商业化价值。",
  },
  {
    key: "design",
    name: "设计打磨",
    weight: 10,
    description:
      "交互与工程打磨：界面完成度、交互体验、可视化与可解释性呈现、细节处理与异常处理。",
  },
  {
    key: "cosmoUsage",
    name: "COSMO Code使用深度",
    weight: 20,
    description:
      "平台使用深度：依据作品说明中的开发过程截图与 COSMO Code 对话记录，核验是否真实基于平台开发；是否有多轮对话迭代，是否有效利用平台能力（Skills/MCP/云端部署等）而非纯外部代码。",
  },
];

export const DIMENSION_MAX_SCORE = 100;

export const TOTAL_WEIGHT = SCORE_DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);
