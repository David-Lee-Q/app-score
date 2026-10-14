export const APP_VERSION = "v0.3.0";

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "v0.3.0",
    date: "2026-10-14",
    changes: [
      "代码仓可访问性自动检测，不可访问标记为「私有」",
      "增强代码仓抓取：GitLab/GitCode 回退读取 README 原始内容",
      "统一全局按钮样式、尺寸与配色，页脚新增版本记录",
    ],
  },
  {
    version: "v0.2.0",
    date: "2026-10-13",
    changes: [
      "总分改为 五维加权分 + 开源加分 + 定向揭榜赛题加分（满分 115）",
      "新增批量全局横向校准与结果 CSV 导出",
      "新增评分历史留存、查看与下载",
      "移除 30 秒视频评分项",
    ],
  },
  {
    version: "v0.1.0",
    date: "2026-10-12",
    changes: ["首个版本：单应用五维加权打分，接入大模型评审"],
  },
];
