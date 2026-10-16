export const BUILT_IN_TOPICS = [
  "基于多智能体协同的高效换产",
  "空压站多机协同智能调度 Agent",
  "离散制造结构件图纸解析智能应用",
  "设备智能管理与预测性维护智能应用",
  "质量缺陷分析与归因智能应用",
  "企业经营数据对话分析智能应用",
  "AI 智能客服与营销转化应用",
  "智能应用创新",
];

export const TOPIC_ALIASES = {
  "基于多智能应用协同的高效换产": "基于多智能体协同的高效换产",
  "空压站多机协同智能调度智能应用": "空压站多机协同智能调度 Agent",
  "AI智能客服与营销转化应用": "AI 智能客服与营销转化应用",
};

export const DIRECTED_TOPICS = BUILT_IN_TOPICS.slice(0, 3);

export const DIRECTED_TOPIC_REQUIREMENTS = {
  "基于多智能体协同的高效换产":
    "面向生产换产场景，必须体现多个智能体之间的协同联动与任务编排（如调度、设备、物料、工装、质量、人员智能体），并聚焦换产效率与换产时间的改善。",
  "空压站多机协同智能调度 Agent":
    "面向空压站场景，必须体现多台空压机之间的协同调度与智能优化（如负荷预测、多目标调度、能效优化），而非仅单机控制或通用能耗看板。",
  "离散制造结构件图纸解析智能应用":
    "面向离散制造的结构件场景，必须体现图纸/模型解析能力（如结构件识别、二维图纸解析、三维建模、BOM/工艺自动生成等）。",
};

function normalize(raw) {
  return String(raw ?? "").replace(/\s+/g, "").trim();
}

export function resolveTopicName(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const compact = normalize(value);
  if (!compact) return "";
  const exact = BUILT_IN_TOPICS.find((t) => t === value);
  if (exact) return exact;
  const compactExact = BUILT_IN_TOPICS.find((t) => normalize(t) === compact);
  if (compactExact) return compactExact;
  const alias = TOPIC_ALIASES[value];
  if (alias) return alias;
  const aliasKey = Object.keys(TOPIC_ALIASES).find(
    (k) => normalize(k) === compact,
  );
  if (aliasKey) return TOPIC_ALIASES[aliasKey];
  const contains = BUILT_IN_TOPICS.find((t) => {
    const tc = normalize(t);
    return value.includes(t) || t.includes(value) || compact.includes(tc) || tc.includes(compact);
  });
  return contains ?? "";
}

export function isDirectedTopic(raw) {
  return DIRECTED_TOPICS.includes(resolveTopicName(raw));
}

export function formatTopicRubric(topic, dimensions = []) {
  const rubric = TOPIC_RUBRICS[topic];
  if (!rubric) return "";
  const guides = Object.entries(rubric.dimensions || {})
    .map(([key, text]) => {
      const dim = dimensions.find((d) => d.key === key);
      return `- ${dim ? dim.name : key}：${text}`;
    })
    .join("\n");
  return (
    `\n\n【赛题评分标准｜${topic}】\n` +
    `赛题类型：${rubric.type}｜所属领域：${rubric.field}\n` +
    `任务目标：${rubric.goal}\n` +
    `基础指标：${(rubric.basicTargets || []).join("；")}\n` +
    `加分指标：${(rubric.bonusTargets || []).join("；")}\n` +
    `各维度评分要点：\n${guides}`
  );
}

export const TOPIC_RUBRICS = {
  "基于多智能体协同的高效换产": {
    type: "场景应用型（定向揭榜）",
    field: "生产制造 · 生产换产",
    goal:
      "构建基于多智能体协同的换产管理系统，将换产全流程拆解为设备调参、物料准备、工装切换、质量验证、人员协同等子任务，各由独立智能体负责并在统一调度下协作，实现换产周期缩短 20%-30%。",
    basicTargets: [
      "换产时间：由 30 分钟缩短至 15-18 分钟",
      "OEE：由 65%-70% 提升至 ≥80%",
    ],
    bonusTargets: [
      "人员效率：人均换产任务完成及时率 100%，人数减少 20%",
      "学习能力：基于历史数据自动优化调度策略、识别瓶颈、沉淀可复用策略模板",
    ],
    dimensions: {
      creativity:
        "多智能体角色分工、任务分配与冲突消解机制的设计，以及对 AGV 延迟、物料短缺等动态异常的适应性决策是否新颖。",
      completeness:
        "调度、设备、物料、工装、质量、人员等智能体角色是否齐备，感知-推理-决策-执行-学习闭环（含执行偏差告警与修正）是否跑通。",
      value:
        "换产周期缩短、OEE 提升等目标是否有可验证数据，及其在离散制造混线生产场景的推广价值。",
      design:
        "换产全流程协同过程可视化、智能体状态与告警呈现、作业时序冲突提示等交互完成度。",
      cosmoUsage:
        "是否基于 COSMO Code 开发出可运行的智能体，是否充分使用平台能力（多轮对话迭代、Skills/MCP、云端部署）。",
    },
  },
  "空压站多机协同智能调度 Agent": {
    type: "场景应用型（定向揭榜）",
    field: "设备运维 · 空压站节能调度",
    goal:
      "基于 COSMO Code 开发空压站多机协同节能调度 Agent，融合工业大模型、多目标优化、健康诊断与预测性维护，具备「感知-推理-决策-执行-学习」全链路能力。",
    basicTargets: [
      "系统综合能效提升 ≥6%、加载率偏离度 ≤±10%、供气压力合格率 ≥99.5%",
      "喘振预警准确率 ≥90%、离心机非计划停机次数下降 ≥50%",
      "调度方案生成 ≤60 秒、自然语言指令理解准确率 ≥90%",
    ],
    bonusTargets: [
      "单站年用电成本降低 5%-10%、MTBF 提升 ≥30%",
      "「大马拉小车」工况时长下降 ≥60%、压力波动幅度下降 ≥30%",
      "异常预警提前 ≥24 小时、喘振预警提前 ≥30 秒、调度策略自适应迭代周期 ≤7 天、关键决策可解释性 ≥80 分",
    ],
    dimensions: {
      creativity:
        "多目标优化调度算法、基于负荷预测的前瞻调度、喘振边界在线修正与跨系统闭环管理的创新性。",
      completeness:
        "负荷预测、调度优化、健康诊断、喘振预警、控制指令等 MCP 服务与感知/决策/执行/交互/学习模块是否落地，关键指标是否可验证。",
      value:
        "能效提升、供气稳定、非计划停机下降等指标达成度，以及在工业空压站场景的节能降碳经济价值。",
      design:
        "运行总览、优化对比、调度方案展示、健康趋势、喘振风险热力图与关键决策逻辑链路展示的完成度。",
      cosmoUsage:
        "是否在 COSMO Code 完成数据治理、模型训练、场景编排、MCP 集成、知识库构建等平台能力使用。",
    },
  },
  "离散制造结构件图纸解析智能应用": {
    type: "工业场景定向揭榜",
    field: "离散制造 / 研发工艺数字化",
    goal:
      "基于 COSMO Code 开发结构件图纸解析应用，实现「上传图纸 → 智能解析 → 3D 呈现 → 尺寸计算 → BOM 拆解 → Excel 导出」闭环，覆盖工程师与工艺/采购人员两类角色，鼓励「AI 识别 + 人工确认」的半自动人机协同方案。",
    basicTargets: [
      "图纸识别准确率 ≥90%（图框/标题栏的图号、名称、材料、材质等关键字段）",
      "BOM 生成完整性：输出层级化材料 BOM（材料/材质/规格/用量/单重）并可导出 Excel",
      "组装尺寸输出：整体外形尺寸与关键配合尺寸清单，支持人工修正留痕",
    ],
    bonusTargets: [
      "3D 呈现能力：可交互 3D 预览或参数化模型（可导出 STEP 等通用格式）",
      "尺寸链与干涉校验：自动计算装配尺寸链、提示干涉/超差风险",
      "数据闭环扩展：BOM 对接采购询价/成本估算、批量图纸解析、错误标注 AI 自检",
    ],
    dimensions: {
      creativity:
        "图纸解析、三维重建、尺寸链计算与 BOM 拆解的技术方案创新性，以及半自动人机协同的设计思路。",
      completeness:
        "「上传图纸 → 智能解析 → 3D 呈现 → 尺寸计算 → BOM 拆解 → Excel 导出」闭环是否跑通，字段/BOM/尺寸输出是否完整可用且支持人工修正留痕。",
      value:
        "对人工读图建模耗时、装配尺寸错漏、BOM 错漏等痛点的缓解程度，及其在中小制造企业的落地与批量应用价值。",
      design:
        "图纸上传与解析交互、3D 交互预览、人工修正留痕与 Excel 导出等使用体验的完成度。",
      cosmoUsage:
        "是否基于 COSMO Code 开发该应用，是否有效利用平台能力完成解析、3D 与导出链路。",
    },
  },
  "设备智能管理与预测性维护智能应用": {
    type: "工业场景开放命题",
    field: "设备运维 · 预测性维护 · 知识沉淀",
    goal:
      "构建设备智能管理与预测性维护应用：感知层采集振动/温度/电流时序并建立健康基线，推理层做早期预警、劣化趋势预测与 RUL 估算，决策层自动生成维护建议与工单并关联备件，知识层沉淀可检索知识库并支持自然语言问答。",
    basicTargets: [
      "故障预警准确率 ≥85%",
      "预警提前时间 ≥24 小时",
      "误报率 ≤10%",
    ],
    bonusTargets: [
      "健康指数输出：0-100 分量化评分并给出评分依据",
      "维修知识库问答：支持自然语言检索",
    ],
    dimensions: {
      creativity:
        "故障早期预警、劣化趋势预测、RUL 估算与维修知识沉淀方案的创新性与技术深度。",
      completeness:
        "感知（时序采集与健康基线）、推理（预警/趋势/RUL）、决策（维护建议/工单/备件关联）、知识（可检索知识库与自然语言问答）四层是否落地闭环。",
      value:
        "故障预警准确率、预警提前时间、误报率等指标达成度，以及减少非计划停机与过度维护的实际收益。",
      design:
        "设备健康看板、预警与工单交互、知识库问答等界面的完成度与易用性。",
      cosmoUsage:
        "是否基于 COSMO Code 开发，是否有效利用平台能力实现数据建模与闭环管理。",
    },
  },
  "质量缺陷分析与归因智能应用": {
    type: "工业场景开放命题",
    field: "质量管控 · 缺陷检测 · 工艺归因",
    goal:
      "构建质量缺陷分析与归因应用，具备知识库构建能力，对检测数据建模，自动识别缺陷类型与严重等级，追溯工艺根因（关联设备参数、物料批次、人员操作、环境条件），输出改进建议，实现「检测→诊断→工艺调整」闭环。",
    basicTargets: [
      "缺陷识别准确率 ≥90%",
      "根因定位准确率 ≥80%",
      "改进建议可执行率 ≥70%",
    ],
    bonusTargets: [
      "缺陷分类种类 ≥5 类",
      "闭环验证：改进后缺陷率下降",
    ],
    dimensions: {
      creativity:
        "缺陷识别建模与工艺根因追溯（关联设备、物料、人员、环境）方案的创新性与归因逻辑的合理性。",
      completeness:
        "「检测→诊断→工艺调整」闭环是否跑通，缺陷识别、根因定位、改进建议输出是否完整且可验证。",
      value:
        "缺陷识别准确率、根因定位准确率、改进建议可执行率等指标达成度，以及对「只检不诊」问题的改善价值。",
      design:
        "缺陷识别结果、根因溯源与改进建议的呈现与交互体验。",
      cosmoUsage:
        "是否基于 COSMO Code 开发，是否有效利用平台能力完成建模与归因分析。",
    },
  },
  "企业经营数据对话分析智能应用": {
    type: "通用场景开放命题",
    field: "数据分析 · 自然语言交互 · 经营管理",
    goal:
      "构建企业经营数据对话分析应用，支持自然语言问数（NL2SQL），实现订单/产量/质量/能耗/交付等多维数据查询，自动生成图表与运营日报，并对异常问题做可解释分析。",
    basicTargets: [
      "问数准确率 ≥90%",
      "图表生成质量：自动选择合适图表类型",
      "多轮对话能力：≥5 轮上下文记忆",
    ],
    bonusTargets: [
      "异常分析深度：归因分析 + 改进建议",
      "运营日报自动生成：定时推送 + 自定义维度",
    ],
    dimensions: {
      creativity:
        "NL2SQL 问数、多维数据查询与异常归因可解释分析的方案创新性。",
      completeness:
        "自然语言问数、图表自动生成、多轮对话、运营日报与异常归因是否落地可用，闭环是否完整。",
      value:
        "问数准确率、图表生成质量、多轮对话能力等指标达成度，以及替代 IT 出报表、缩短经营决策链路的实际价值。",
      design:
        "对话式问数交互、图表呈现与运营日报推送等使用体验的完成度。",
      cosmoUsage:
        "是否基于 COSMO Code 开发，是否有效利用平台能力实现数据接入与问数分析。",
    },
  },
  "AI 智能客服与营销转化应用": {
    type: "通用场景开放命题",
    field: "智能客服 · 营销转化 · 线索管理",
    goal:
      "构建 AI 智能客服与营销转化应用，实现「咨询→推荐→转化→沉淀」完整链路：意图识别、产品推荐、多轮对话管理、知识库问答、潜客线索沉淀，并做到服务端按角色/数据/操作授权、回答有依据可追溯。",
    basicTargets: [
      "意图识别准确率 ≥85%",
      "产品推荐命中率 ≥75%",
      "知识库问答准确率 ≥80%",
      "平均响应时间 ≤3 秒",
    ],
    bonusTargets: [
      "潜客线索识别率 ≥60%",
      "从咨询到推荐的转化率 ≥30%",
    ],
    dimensions: {
      creativity:
        "「咨询→推荐→转化→沉淀」全链路设计，以及意图识别、主动推荐与潜客结构化沉淀的创新性。",
      completeness:
        "意图识别、产品推荐、多轮对话、知识库问答、潜客沉淀与权限可信管控是否落地，越权拒绝与幻觉管控是否有效。",
      value:
        "意图识别准确率、推荐命中率、知识库问答准确率、响应时延等指标达成度，以及营销转化提升的实际价值。",
      design:
        "对话体验、产品推荐与线索卡片呈现、可信回答与替代路径提示等交互完成度。",
      cosmoUsage:
        "是否基于 COSMO Code 开发出可运行、可交互的智能客服应用，是否有效利用平台能力。",
    },
  },
  "智能应用创新": {
    type: "开放命题 / 自由命题",
    field: "不限领域（工作 · 生活 · 社交 · 教育 · 公益等）",
    goal:
      "参赛者自选任意领域的真实痛点，设计并实现体现 AI「感知-推理-决策」能力的智能应用，并提交场景分析报告（说明痛点、影响与现有方案不足）与可运行 Demo。",
    basicTargets: [
      "痛点真实性：由参赛者自选并需在场景分析报告中说明痛点、影响与现有方案不足",
      "AI 能力体现：应用需体现 AI 的「感知-推理-决策」能力，而非简单自动化",
    ],
    bonusTargets: [
      "Demo 可运行性、场景分析报告质量与方案创新度",
    ],
    dimensions: {
      creativity:
        "真实痛点发现的新颖度与 AI 赋能切入角度，是否体现「感知-推理-决策」而非简单自动化。",
      completeness:
        "可运行 Demo 与场景分析报告是否完整，AI 能力链路是否形成闭环。",
      value:
        "痛点影响程度与现有方案不足的论证是否充分，以及应用的实际效果与推广空间。",
      design:
        "交互体验、界面完成度与细节处理。",
      cosmoUsage:
        "是否基于 COSMO Code 开发，是否有效利用平台能力实现应用。",
    },
  },
};
