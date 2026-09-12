# CURRENT_STATE.md — 现有仓库审查结果

> 依据《Amazon AI 决策系统｜V2 实施指令》Step 1 输出。
> 审查时间：2026-09-11
>
> **V2.1 更新（2026-09-11）**：本项目已在 V2 基础上完成《V2.1 真实数据优先》改造。当前项目状态：**REAL_DATA_INTEGRATION**（Architecture Prototype: Complete / Real Data Integration: In Progress / Production Validation: Not Passed）。V2.1 交付物：11 张新表 + 8 Provider Registry + DEMO/REAL/HYBRID 模式 + Data Plan + Raw 存储 + 对账/校准/Evidence 全链穿透 + 9 项 Red Team 测试（全量 31/31 通过）；4 个真实 SellerSprite ReverseASIN 文件导入验收（113 行 × 32 列全映射、0 未映射），对账 MATCH=604 / DIFFERENT=0。五份必交报告见项目根（V2_1_GAP_AUDIT / REAL_DATA_INTEGRATION_REPORT / SELLERSPRITE_MAPPING_REPORT / AMAZON_INTEGRATION_STATUS / RED_TEAM_TEST_REPORT）。Amazon 官方数据与真实 4 SKU 录入待用户提供凭据/数据。

## 1. 结论摘要

**本机未发现任何现存的 Amazon AI 选品/决策系统代码仓库。**

V2 指令中"完整审查现有仓库"的前提在当前环境下不成立：本项目目录（`C:\Users\JT\Doubao\chats\2026-09-11\new-chat`）为空，常见代码目录（Desktop / Documents / source / projects / workspace / code / Doubao 各会话目录）中均未检索到 Amazon / 选品 / 决策 / Jarvis / cockpit 相关的代码工程。

因此本版本按 **从零新建** 处理，技术选型见第 5 节；同时保留 V2 指令要求的全部架构约束（工作流优先、确定性计算与 AI 分离、Evidence 可追溯、Mock 明确标记等）。

## 2. 可复用的现成资产

| 资产 | 位置 | 状态 | 用途 |
|---|---|---|---|
| 《Amazon AI 选品情报决策中心 第一版完整系统设计》（V1） | `C:\Users\JT\Downloads\Amazon_AI选品情报决策中心_第一版完整系统设计_Agent实施指令.md` | 已读全 | 业务域、数据模型、页面结构、验收标准的母本 |
| 《Amazon AI 决策系统 V2 实施指令》（V2，本版主指令） | `C:\Users\JT\Downloads\Amazon_AI决策系统_V2实施指令_工作流优先版.md` | 已读全 | 本版实施范围与优先级 |
| Amazon AI Operations OS 系列设计文档（M1–M1.9） | `C:\Users\JT\Downloads\Amazon AI Operations OS — *.md` | 未纳入本版范围 | 属另一条"运营系统"产品线，如需与选品决策中心打通，后续单独评估 |
| Amazon AI Operating Cockpit PRD v1.0 | `C:\Users\JT\Downloads\Amazon_AI_Operating_Cockpit_PRD_v1.0.docx` | 未纳入本版范围 | 同上 |
| 会议记录《亚马逊数据分析体系搭建讨论会》 | `C:\Users\JT\Downloads\亚马逊数据分析体系搭建讨论会·会议记录.md` | 未纳入本版范围 | 业务背景参考 |
| SellerSprite 反查导出样例（ReverseASIN-*.xlsx） | `C:\Users\JT\Downloads\ReverseASIN-*.xlsx` | 存在样例 | 后续接入真实导入时可作为格式参考 |

> 说明：上述"未纳入本版范围"的文档在 Downloads 中存在，但用户本轮仅上传 V1 与 V2 两份实施指令，故本版严格按 V2 范围执行，不主动扩展。

## 3. 业务事实（来自 V1/V2，作为本版硬约束）

1. 第一阶段围绕公司正在运营的 **4 个记忆棉枕头 SKU**。
2. 模块一：现有记忆棉枕头市场诊断；模块二：4 SKU 竞争表现诊断；模块三：记忆棉相关待开发产品；模块四：全新赛道/新品机会。
3. 系统核心对象是 **Research Job（研究任务）**，不是聊天、不是页面。
4. 确定性计算（增长率/均值/中位数/百分位/集中度/硬门槛/评分/状态流转）由 **代码** 完成，AI 只做解释/归因/评论归类/反方审查/决策建议。
5. 所有 AI 结论必须落到 **Evidence**，可追溯：结论 → 计算 → 证据 → 原始数据 → Research Job。
6. **历史快照只追加、禁止覆盖**；缺失数据一律 `null` + `missing_reason`，禁止补 0。
7. Mock/Demo 数据必须全局标记 `is_demo=true`，UI 永久显示演示数据横幅，严禁伪装真实。
8. 重大动作必须过 **Approval Gate**；人做最终决策，决策写入 **Decision Log**。
9. 评分不能抵消 Hard Gate；数据不足时 AI 必须敢于输出"当前无法判断"。

## 4. 技术栈审查结果

| 项 | 结果 |
|---|---|
| 现有语言/框架 | 无（从零新建） |
| 本机 Node.js | v22.23.2（内置 `node:sqlite`，无需原生编译依赖） |
| 本机 npm | 10.9.8 |
| 本机 Python | 3.14.7（未采用，选品系统以 Node 实现为主） |
| 数据库 | SQLite（`node:sqlite`），本地零配置，单文件持久化 |
| 后端 | Node.js + TypeScript + Express |
| 测试 | `node:test` + tsx |
| 前端 | 静态页（原生 JS + ECharts 可选），由 Express 托管，无前端构建链 |

## 5. 本版要新建什么（P0 全景）

1. 数据模型 + 数据库 Schema（28 张表，见 V2 §55）
2. ResearchJob / ResearchStep 状态机 + Workflow Orchestrator
3. Data Adapter（MockAdapter / ImportAdapter(CSV) / ManualInputAdapter）
4. Data Normalization Engine（字段元数据、缺失处理、禁止补 0）
5. Snapshot 历史库（Market / Product / Keyword，追加式）
6. Rule Engine（RuleProfile + Relative Performance + Hard Gate + V2 评分体系）
7. Evidence Engine
8. AI 分析 Agent（market / sku / review-gap / reverse-review，LLM 可配置，缺 Key 时确定性降级）
9. 四条工作流（existing-market / owned-product / adjacent-product / new-opportunity）
10. Approval Gate + Decision Log + Missing Data Queue
11. REST API（V2 §56 清单）
12. 最小 UI（第一批 7 个页面能力）
13. Demo 种子数据（4 SKU / 记忆棉市场树 / TOP100 / 评论，全部 is_demo=true）
14. 测试（单测 + 集成，覆盖两个验收任务）

## 6. 当前问题 / 风险

| 风险 | 等级 | 应对 |
|---|---|---|
| 无真实 SellerSprite MCP/API 凭据 | 高 | Adapter 隔离 + Mock 先行 + CSV 导入通道，真实接入点预留（见 README） |
| 无 4 个 SKU 的真实 ASIN/数据 | 高 | 自有产品管理支持录入；Demo 种子用占位 ASIN（SKU-A/B/C/D），随时可替换 |
| AI LLM Key 未配置 | 中 | AIService 双模式：配置 Key 走 LLM 结构化输出；未配置走确定性分析（记录 model=rule-based-v1，不假装是 LLM） |
| 前端构建链缺失 | 低 | 静态页方案，避免构建步骤，保证本地可直接运行 |

## 7. 实施完成状态（2026-09-11 更新）

**本版（第一阶段 P0）已全部实现并验证运行：**

- 28 表 SQLite + 版本化迁移 + 追加式快照（同日防覆盖）✅
- 四条工作流 + Research Job 状态机 + 编排/重试 ✅
- Mock / CSV / 手动三通道 Adapter；缺失数据队列（禁补 0）✅
- RuleProfile（3 套默认档案）+ HardGate 7 门 + 五维评分 + 相对表现分级 ✅
- 确定性 AI Agent ×4 + LLM 可切换；Evidence 全链路可追溯 ✅
- 人工审批 + 决策日志 + 机会池（promote/reject 均验证）✅
- REST API（V2 §56 全清单 + 简报 + AI 状态）+ 首批 UI（7 页面能力 + DEMO 横幅）✅
- 22 项单元/集成测试全部通过；`tsc --noEmit` 通过 ✅

**验收任务实测（2026-09-11，全演示数据）：**

| 验收任务 | 结果 |
|---|---|
| A：灰色枕头 SKU-A 诊断 | 🔴 明显跑输 —— 市场 30D +12.2% / SKU 30D +0.8% / 相对 -11.4%，3 条证据带算式，置信度 0.85 |
| B：U 型枕是否值得开发 | HardGate PASS → 评分 73.5（值得研究）→ 评论缺口 + 反向审查 → 机会池待审批 → 审批/转开发链路验证通过 |
| C：新赛道（小学一年级开学用品） | 如实输出 needs_data + 5 项数据需求清单 + 研究树 6 节点（非阻塞） |

**已修复的运行时缺陷（均加回归测试）：**
1. 快照序列写入曾把 5 个日期写成同一数值（series 值未随日期变化）→ `saveMarketSnapshot/ProductSnapshot` 改为优先取序列项字段。
2. 状态机缺 `validating` 中转导致 422 → 四条工作流补齐迁移链。
3. owned_product 工作流 normalize 市场曾用全 null 数据（市场只有"今日"一张空快照 → 增速算不出 → 数据不足）→ 改为拉取含 5 期快照的市场画像。
4. 反方审查/评论缺口在"无发现"场景不落证据 → 补充如实证据（has_ad_data=0 / review_gap_issues_found=0）。

**运行方式**：`npm start` → http://localhost:3000（自动建库种数据）；`npm run verify` 全链验证。
