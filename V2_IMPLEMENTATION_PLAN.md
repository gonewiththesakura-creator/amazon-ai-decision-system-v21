# V2_IMPLEMENTATION_PLAN.md — 实施计划

> 依据《Amazon AI 决策系统｜V2 实施指令》Step 2 输出。只写迁移/变更/顺序/风险，不复述需求。

## 1. 迁移方案

本机无现存仓库 → 无数据迁移，全部为**新建**。数据库使用 SQLite（`node:sqlite` 内置驱动），采用"schema 幂等执行 + `PRAGMA user_version` 版本号"的轻量迁移机制：`src/db/migrations.ts` 内维护版本数组，启动时按版本逐个应用，后续加表/加字段只需追加版本条目。

## 2. 数据库变更（新建 28 张表）

| 组 | 表 | 说明 |
|---|---|---|
| 研究任务 | `research_jobs` / `research_steps` | Job 状态机 + Step 过程日志（含 retry_count / error） |
| 市场 | `markets`（MarketNode）/ `market_snapshots` | 任意树深 + 追加式快照 |
| 关键词 | `keywords` / `keyword_snapshots` | ABA 类数据预留 |
| 产品 | `products` / `product_snapshots` | 通用产品 + 追加式快照 |
| 自有 | `owned_products` / `competitor_relations` | 4 SKU 管理 + 竞品分组（direct/top100/benchmark/fast_growth/price_peer） |
| 评论 | `reviews` / `review_insights` | Review Gap 分析输入与产出 |
| 规则 | `rule_profiles` / `rule_executions` / `score_results` | 规则版本化、执行留痕、评分子项 |
| AI | `ai_insights` / `evidence` | 结构化洞察 + 证据链（input_hash 防重复调用） |
| 决策 | `opportunities` / `decisions` / `watchlists` | 机会池 + 决策日志 + 监控对象 |
| 数据 | `data_sources` / `data_tasks` / `missing_data_items` | 数据源、任务执行、缺失数据队列 |

关键约束（建表语句落实）：
- Snapshot 只 INSERT，无 UPDATE 路径；`UNIQUE(market_id, snapshot_date)` 防同日重复追加。
- 缺失字段存 `null`，`missing_reason` 必填；禁止默认 0。
- `evidence` 引用 `ai_insights`，`insight_id` 非空。
- 所有表带 `is_demo` 或通过 `source_metadata` 标记数据来源。

## 3. 新模块清单

```
src/
  types/models.ts           类型定义（与 28 表一一对应）
  db/schema.ts              建表 SQL
  db/migrations.ts          版本化迁移
  db/connection.ts          连接与初始化
  modules/research/         状态机 + Step 记录
  modules/rules/            rule-profile / relative-performance / hard-gates / scoring
  modules/evidence/         evidence 写入与校验
  modules/decisions/        approval gate + decision log + opportunity pool
  modules/monitoring/       watchlist + 异常规则
  adapters/                 mock / import(csv) / manual
  normalization/            标准化引擎
  workflows/orchestrator.ts + 4 条工作流
  ai/service.ts + agents/   LLM 双模式 + 4 个分析 Agent
  api/routes.ts + index.ts  REST API + 静态托管
  seed/seed-demo.ts         演示数据种子（is_demo=true）
```

## 4. 开发顺序（P0 → P1 首批）

1. 脚手架（package.json / tsconfig / env / AGENTS.md / README）
2. 类型 + Schema + 迁移（跑通建库）
3. ResearchJob 状态机 + ResearchStep
4. Adapter + Normalization（Mock 数据生成）
5. Snapshot 引擎
6. Rule Engine（相对表现 / Hard Gate / V2 评分）
7. Evidence + AI 分析 Agent（确定性降级）
8. Workflow Orchestrator + 四条工作流
9. Approval Gate + Decision Log + Missing Data Queue
10. REST API
11. 最小 UI（Job 列表 / Job 详情 / 市场页 / SKU 战情 / 证据抽屉 / 审批面板 / 数据任务中心）
12. 种子数据 + 两个验收任务跑通
13. 测试补齐（lint / typecheck / unit / build / 集成）
14. 交付文档

> P1 后续项（Review Gap 完整闭环、Scheduler 定时、Rule Profile UI、Skill 库、完整 AI 对话）在架构中预留接口，本版实现核心闭环。

## 5. 风险与应对

| 风险 | 应对 |
|---|---|
| `node:sqlite` 在 Node 22 为实验特性 | v22.23.2 无需 flag 可直接用；若报错退回 better-sqlite3（需要本机编译工具链，备选） |
| Mock 数据被误认为真实 | 全链路 `is_demo` 标记 + UI 永久横幅 + API 响应头 `X-Demo-Data: true` |
| LLM 未配置导致 AI 结论缺失 | 确定性分析引擎兜底（增长率/百分位/集中度/规则结论全部代码计算），AI 层只做解释，模型名如实记录 |
| 工作流中途失败 | 状态机每步落库，失败置 `failed` 并保留 error；支持 `retry`（从失败步骤重放） |
