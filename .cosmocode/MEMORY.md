# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

### 单服务构建与启动
- Date: 2026-10-15
- Context: Agent 在将前后端合并为单服务时发现
- Category: 构建方法
- Instructions:
  - 前端构建产物由后端 Express 统一托管，单服务单端口（默认 3001）；根路径 `/` 即首页，非 `/api` 路由回退到 `dist/index.html`
  - 单服务启动命令：`npm start`（先 `npm run build` 再启动 `server/index.js`），或 `bash start.sh`
  - 热更新调试仍可用 `npm run dev`（Vite，5173，代理 `/api` 到 3001），此时需另行 `PORT=3001 npm run server`
