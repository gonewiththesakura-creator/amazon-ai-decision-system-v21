# V2_1_GAP_AUDIT.md — V2 → V2.1 差距审计

> 依据《Amazon AI 决策系统｜V2.1 实施指令》Step 1 输出。
> 审计对象：`amazon-ai-decision-system`（V2 已实现全量代码，22 项测试通过）。
> 审计时间：2026-09-11

---

## 1. 审计结论

**V2 架构骨架（工作流/规则/Evidence/审批）成立，但数据主路径全部是 Mock，按 V2.1 定义不满足"真实数据优先"。**

- 架构适配性：业务层/规则层/AI 层与数据源已解耦（Adapter 隔离成立），V2.1 §58"真实数据进来后核心逻辑需要重写"的风险**不成立**——核心逻辑无需重写，需要新增数据层设施与真实 Provider。
- 数据现实：系统当前 100% 走 Mock（`is_demo=true` 全局标记）。真实 SellerSprite ReverseASIN 导出文件存在于本机 Downloads（4 份，2026-08-20），**未做任何真实导入验证**。
- 结论：本版从 `PROTOTYPE` 进入 `REAL_DATA_INTEGRATION`，按 P0-1 ~ P0-10 执行。

---

## 2. 差距清单（按 V2.1 章节映射）

### 2.1 模式与数据主路径（§6, §7, §58）

| # | 差距 | 现状 | 影响 |
|---|---|---|---|
| G1 | 无全局模式（DEMO/REAL/HYBRID） | 只有 `is_demo` 行级标记；无模式开关 | 无法保证"真实模式下禁止 Mock 兜底" |
| G2 | REAL 模式下缺数据会自动 fallback 到 Mock | 工作流硬编码 `getAdapter('mock')` | 违反 §6：真实模式缺数据必须 `needs_data` |
| G3 | 无字段级数据标签（REAL/ESTIMATED/ASSUMPTION/MOCK） | 标准化后字段无 provenance | AI/规则无法区分"真实"与"估算" |
| G4 | workflows 硬编码 `is_demo: true` 写入 | existing/owned/adjacent workflow 直接传 `is_demo: true` | 真实数据进来会污染演示标记 |
| G5 | UI 只有 DEMO 横幅 | 无 REAL/HYBRID 横幅、无真实数据覆盖度 | §42 真实数据 Dashboard 缺失 |

### 2.2 Provider 与能力矩阵（§2, §3, §4）

| # | 差距 | 现状 | 影响 |
|---|---|---|---|
| G6 | 无 Provider Registry | `getAdapter(name)` 简单工厂 | 无法统一注册/查询多 Provider |
| G7 | 无业务能力接口 | Adapter 接口按平台数据形态定义（RawMarketData 等） | 无法让多个 Provider 服务同一业务能力 |
| G8 | 无 Capability Matrix | 无 | 系统不知道"哪个源能提供哪些字段" |
| G9 | 无 Source Priority Profile | 无 | 多源冲突时无优先级依据 |
| G10 | SellerSprite MCP/API Adapter 不存在 | 无 | P0-2/P0-3 未做 |
| G11 | Amazon SP-API / Ads Adapter 不存在（连边界都没有） | 无 | P0-4、P1 Ads 无落点 |

### 2.3 数据层设施（§9, §10, §11, §12, §40）

| # | 差距 | 现状 | 影响 |
|---|---|---|---|
| G12 | 无 `raw_ingestions` / `raw_records` | 只存清洗后数据 | Evidence 回不到原始行（§9） |
| G13 | 无 `normalization_mappings` | 映射硬编码在 csv-adapter `COLUMN_MAP` | 映射不可追溯、不可对账 |
| G14 | 无 Import Mapping Queue | 未知列静默跳过 | §40 违反：未映射列必须进队列 |
| G15 | 无 Mapping Template | 无 | 无法保存/复用映射模板 |
| G16 | 无 Data Reconciliation | 无 | §11 对账功能缺失 |
| G17 | 无第三方估算校准（Bias/MAPE/Median Error） | 无 | §22 关键能力缺失 |
| G18 | 无 Conflicting Data 并存展示 | 单源写入 | §21 冲突被静默覆盖 |
| G19 | xlsx/tsv 不支持 | csv-adapter 仅 CSV | §1.3 要求 CSV/XLSX/TSV |
| G20 | 无 Data Plan | 无 | §5 任务启动前无数据计划 |

### 2.4 Evidence 与追溯（§8, §23, §24）

| # | 差距 | 现状 | 影响 |
|---|---|---|---|
| G21 | Evidence 无法穿透到 Raw | 只有 `assertEvidenceIntegrity`（ID 存在性） | §24 要求 trace integrity 全链校验 |
| G22 | 无 `GET /api/evidence/:id/trace` | 无 | §23 追溯 API 缺失 |
| G23 | 无 Lineage 链路落库 | 各环节孤立 | §8 数据链不可全览 |

### 2.5 业务能力（§17, §25, §29, §30, §31, §32, §33）

| # | 差距 | 现状 | 影响 |
|---|---|---|---|
| G24 | Owned Products 无独立创建 API | 靠 `development-projects` 顺带创建 | §17 业务边界必须分开 |
| G25 | 状态 `monitoring` 被当"自动监控"用 | 4 个工作流终态为 monitoring | §25 无 Scheduler 前必须用 `monitor_ready` |
| G26 | Decision 无 role 字段 | 只有 decided_by | §30 需要 Admin/Reviewer |
| G27 | Reverse Review 无证据引用与 hypothesis 标注 | failure mode 无 specific_evidence/counter_argument | §32 未达标 |
| G28 | AI 输出无 FACT/CALCULATED/ESTIMATED/HYPOTHESIS 标签 | 无 | §33 未达标 |
| G29 | 无 Data Completeness Score | 评分有 data_completeness 字段但未实现 | §43 未达标 |
| G30 | 无真实评论导入通道验证 | reviews 表存在但仅 Mock | §31 未验证 |

### 2.6 对抗与测试（§28, §38, §39, §53）

| # | 差距 | 现状 | 影响 |
|---|---|---|---|
| G31 | 无 Red Team 测试 | 有 22 项常规测试 | §28 HardGate 攻击 / 审批绕过 / 恶意数据均无 |
| G32 | 无"REAL 禁 Mock fallback"测试 | 无 | §53 第一项缺失 |
| G33 | 无重复 ASIN / 恶意格式（NA、0、$39.99、GBK/BOM…）测试 | 无 | §39 未覆盖 |
| G34 | 黑盒验收未做 | 无真实文件盲测 | §38 未执行 |

---

## 3. 需要保留的 V2 资产（不重写）

- 28 表 Schema 主体（research_jobs / evidence / rule_profiles / snapshots / opportunities…）
- Research Job 状态机与四条工作流骨架（仅 `monitoring`→`monitor_ready` 与 mock 依赖需改）
- 确定性规则引擎（HardGate / 评分 / 相对表现）—— 与数据源解耦，直接复用
- Evidence Engine 基础（createEvidence / assertEvidenceIntegrity）
- AI 确定性 Agent 骨架（market / sku / review-gap / reverse-review）
- REST API 框架与第一批 UI

---

## 4. 实施顺序（对应 V2.1 §51/§59）

```text
Step 2  数据层：raw_ingestions / raw_records / normalization_mappings / mapping_queue /
        provider_status / calibration_stats / source_conflicts / system_settings(mode) /
        data_plans / reconciliation_results（migration v2）
Step 2   Provider Registry + 业务能力接口 + Capability Matrix + Source Priority
Step 3   模式管理（DEMO/REAL/HYBRID）+ 工作流 Data Plan + REAL 禁 Mock
Step 4   Evidence V2.1（trace 链路 + /api/evidence/:id/trace + assertEvidenceTraceIntegrity）
Step 5   真实文件：ReverseASIN xlsx 导入验收（4 份真实文件）+ Mapping Queue + 对账 + 校准
Step 6   Owned Products 独立 API + Amazon SP-API/Ads 边界
Step 7   Red Team 测试 + 恶意数据测试
Step 8   UI（模式横幅 / 覆盖度 / 对账 / 导入）
Step 9   交付 5 份报告 + README 阶段标注
```

## 5. 已确认的真实输入

| 文件 | 市场 | 行数 | 类目 |
|---|---|---|---|
| ReverseASIN-MX-B0BYP8MCVG(24)-20260820.xlsx | MX | 24 | 假发（pelucas） |
| ReverseASIN-MX-B0FDJMGSWJ(28)-20260820.xlsx | MX | 28 | 假发 |
| ReverseASIN-MX-B0GSSXNVRC(18)-20260820.xlsx | MX | 18 | 假发 |
| ReverseASIN-US-B0FL7FX7T1(43)-20260820.xlsx | US | 43 | 假发（braiding hair） |

> 说明：以上为真实 SellerSprite ReverseASIN 导出（关键词×流量数据），用于 P0-1 导入管线验收；与 4 个记忆棉枕头 SKU 属不同类目，真实记忆棉市场/竞品数据仍需用户提供或后续抓取。
