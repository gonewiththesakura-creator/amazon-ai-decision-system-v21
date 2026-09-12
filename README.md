# Amazon AI 决策系统 V2.2（Live Provider Execution）

> 依据《Amazon_AI决策系统_V2.1_真实数据优先实施指令》在 V2（工作流优先版）基础上改造，并于 V2.2 按《Amazon_AI决策系统_V2.2_LiveProvider修复指令》完成 Live Provider 执行：
> **Mock 用来开发系统，真实数据用来证明系统；SellerSprite 负责市场竞品，Amazon 负责自有真实数据；Amazon 官方优先于第三方估算；系统能对账、校准、追溯、发现冲突。**
> V2.2 目标：REAL 模式下 Research Job 的最终 Snapshot/Metric/Evidence/Insight **必须来自真实 Provider 或真实导入数据**，禁止任何隐式 Mock。
> 目标：4 个真实 SKU 能跑（而不是 Demo 能跑）。

***

## 0. 项目阶段标注（§60，三段式，2026-09-12）

| 阶段 | 状态 | 说明 |
|---|---|---|
| Architecture Prototype | **Complete** | V2 全链路 + V2.1 数据层/Provider/模式/对账/校准/Evidence/硬门禁 + V2.2 Provider 执行（Context 唯一入口 / 8 态健康检查 / 真实 MCP/API/SP-API/Ads 客户端 / Import null+SHA256 / Sentinel / HTTP Black Box）全部落地，37/37 测试通过 |
| Real Data Integration | **In Progress** | SellerSprite 真实文件已导入验收（113 行 × 32 列，假发数据仅证明管线）；**记忆棉真实文件 / 真实 4 SKU / Amazon 凭据或报表待提供**（缺项按 §62 如实标 FAIL，见 V2_2_REAL_MEMORY_FOAM_DATA_REPORT.md / V2_2_AMAZON_LIVE_STATUS.md） |
| Production Validation | **Not Passed** | 未经任何生产环境/真实资金验证，严禁用于真实业务决策 |

> 项目当前状态：**REAL_DATA_INTEGRATION**（**未标注 "Live Provider Connected"**——真实凭据与记忆棉数据到位并通过验收后才可升级标注）
> V2.1 五份必交报告：`V2_1_GAP_AUDIT.md` · `REAL_DATA_INTEGRATION_REPORT.md` · `SELLERSPRITE_MAPPING_REPORT.md` · `AMAZON_INTEGRATION_STATUS.md` · `RED_TEAM_TEST_REPORT.md`
> V2.2 五份必交报告：`V2_2_PROVIDER_EXECUTION_AUDIT.md` · `V2_2_LIVE_PROVIDER_REPORT.md` · `V2_2_BLACKBOX_TEST_REPORT.md` · `V2_2_REAL_MEMORY_FOAM_DATA_REPORT.md` · `V2_2_AMAZON_LIVE_STATUS.md`

## 1. 当前状态（2026-09-12）

**运行中：**[http://localhost:3000](http://localhost:3000)（服务已后台启动；`data/amazon-ai.db` 含演示数据 + 4 个真实 SellerSprite 导入批次）

### V2.2 已实现 ✅（Live Provider Execution）

| 板块 | 内容 |
| ---- | ---- |
| Provider 唯一入口 | `WorkflowDataContext`（jobId/mode/dataPlan/providers）+ `buildWorkflowContext` + `getCapabilityProvider`；4 条 Workflow 全部改为 `(jobId, ctx)`，数据只经能力解析，**生产无 `getAdapter('mock')`、无硬编码 `is_demo: true`** |
| 8 态健康检查 | UNCONFIGURED/CONFIGURED/CONNECTING/CONNECTED/DEGRADED/RATE_LIMITED/UNAUTHORIZED/ERROR；**Connected 唯一来源 = 真实 healthCheckRemote 成功**（填 env 不等于 Connected）；启动异步刷新 + `POST /api/providers/health/refresh` |
| 真实客户端 | SellerSprite MCP（stdio JSON-RPC 握手/工具发现/调用）、SellerSprite API（X-Api-Key 真实 HTTP）、Amazon SP-API（LWA + Orders 真实查询 = Connected）、Amazon Ads（LWA + profiles 真实查询 = Connected） |
| Amazon Import 修复 | 缺失字段保留 null + missing_data_items（不补 0）；payload_hash 真 SHA256；五类报表 Mapping Template + 未知列 → mapping_queue；healthCheckRemote = 真实导入记录 |
| Sentinel Real Provider | `SENTINEL_PROVIDER=market/owned/1` 注册 isMock=false Provider（987654 / 4321+17.89），按能力注入 SOURCE_PRIORITY，供 REAL 黑盒验收 |
| 双保险 | Data Plan 层 `assertNoMockProviders` + Normalize 前 Runtime Mock Guard（REAL + raw.source='mock' → throw） |
| 测试 | **37/37**（31 项 V2.1 回归 + 5 项 V2.2 HTTP Black Box + 容器）· `npx tsc --noEmit` 0 error |
| 真实导入 | ReverseASIN xlsx/csv/tsv 解析（UTF-8/GBK/BOM 自动识别；$39.99 / 39,99 / MX$0.02 / 12% 数值化）；32 列中文映射；raw 全量留存；未知列进 mapping_queue；同日快照幂等覆盖 |
| Data Plan | 任务运行前生成数据计划（buildDataPlan），缺能力记 missing_data_items 并转 needs_data |
| 对账 | reconcileKeywordIngestion（MATCH/DIFFERENT/MISSING/TRANSFORMED）+ 幂等重跑；关键字段正确率 100%（DIFFERENT=0） |
| 校准 | Bias/MAPE/Median Error；CALIBRATED_ESTIMATE 绝不冒充真实；Actual/Estimated 冲突并存显示（含 variance） |
| Evidence V2.1 | buildEvidenceTrace 全链穿透（Insight→Metric→Snapshot→Normalized→RawRecord→RawIngestion→Source→Decision）+ 完整性断言 |
| 硬门禁 | approve 非 waiting_approval → **403 APPROVAL_BYPASS_BLOCKED**；reject 非法同样 403 |
| API | /api/system/mode · /providers/status · /providers/capabilities · /import/sellersprite/reverse-asin · /import/amazon/report · /imports · /mapping-queue(+resolve) · /reconciliation/run · /calibration · /conflicts · /evidence/:id/trace · /owned-products(409) · /dashboard/coverage · /jobs/:id/data-plan |
| UI | 数据源与覆盖度页（模式切换/覆盖度/Provider/导入批次/冲突/映射队列）；三态模式横幅 |
| 测试 | **31/31**（22 项 V2 + 9 项 V2.1 Red Team：REAL 禁 Mock / Raw trace / 未知列 / 重复导入 / 冲突并存 / 审批绕过 403 / HardGate 3 案例 / 恶意数据 / 映射正确率）|

### 真实数据验收结果 ✅（2026-09-11 实测）

- 4 个 SellerSprite ReverseASIN 真实文件导入：**113 行、32 列全映射、0 未映射列**（MX×3 + US×1，假发类目，2026-08-20 快照）；
- 对账（US 批次 43 行，215 条逐字段）：**MATCH=200 / DIFFERENT=0 / MISSING=15**（源文件空值如实标记）；关键字段正确率 100%；
- REAL 模式运行 owned_product 任务 → **needs_data**（缺 capability:owned_orders，绝不 Mock 兜底）；
- Provider：sellersprite_import=Connected；Amazon 系 4 个=Unauthorized（凭据未配置，如实标注）；
- 覆盖度：market=ESTIMATED · owned_sales=MISSING · competitor_sales=ESTIMATED（269 条真实关键词快照）· ads=MISSING · supply_chain=PARTIAL。

### 未实现 / 待真实输入（如实声明）⚠️

- **Amazon 官方数据**：SP-API / Ads / 报表均未配置凭据或文件（接口与数据模型就绪）；
- **真实 4 SKU**：需要 ASIN / 店铺 / 成本 / 库存录入（owned-products API 已就绪）；
- **SellerSprite MCP/API 通道**：仅文件导入（sellersprite_import）已验证；
- **LLM 分析**：未配置 AI_API_KEY（缺省走确定性规则引擎）；
- **后续模块**：定时任务 / 运营财务广告模块 / 更多 UI 页面（非 V2.1 验收范围）。

* **lint**：`npm run lint` 目前是 `tsc --noEmit --strict` 别名（未引入 ESLint）；`npm run build` 为类型检查 + 标记（未产出 dist 产物，运行依赖 tsx）。



***

## 2. 数据库迁移



* 迁移脚本：`src/db/migrations.ts`，通过 `PRAGMA user_version` 版本化，启动时自动执行。

* 当前版本：见 `migrations.ts` 中 `TARGET_VERSION`。

* 重置演示数据：停服务后删除 `data/amazon-ai.db*`（含 WAL），重启自动重建并种入演示数据。

## 3. 核心文件



```
src/

&#x20; db/          schema.ts（28 表）· migrations.ts · connection.ts（单例/内存测试）

&#x20; modules/

&#x20;   research/  job.ts（Research Job + 状态机 + Step 落库）

&#x20;   snapshots/ engine.ts（快照追加 + 增速）

&#x20;   normalization/ engine.ts（标准化 + 缺失队列）

&#x20;   rules/     profile.ts（RuleProfile）· engine.ts（HardGate/评分/相对表现）

&#x20;   evidence/  engine.ts（证据 + 完整性校验）

&#x20;   decisions/ engine.ts（审批 + 决策日志 + 机会池）

&#x20; adapters/    types.ts · index.ts · mock/mock-adapter.ts · import/csv-adapter.ts · manual/manual-adapter.ts

&#x20; ai/          service.ts（双模式）· agents/（market/sku/review-gap/reverse-review）

&#x20; workflows/   orchestrator.ts + 四条 workflow + helpers.ts

&#x20; api/         routes.ts（全部 REST）

&#x20; seed/        seed-demo.ts（4 SKU + 3 规则档案 + 4 演示 Job）

prompts/       \*.v1.md（版本化 prompt）

tests/         unit/ + integration/（22 项）

public/        index.html · styles.css · app.js（第一批 UI）
```

## 4. 如何本地运行



```
\# Windows / PowerShell

cd amazon-ai-decision-system

npm install          # 依赖仅 express

npm start            # 启动 http://localhost:3000（自动建库 + 种演示数据）

npm run typecheck    # tsc --noEmit（strict）

npm run test         # 22 项测试

npm run verify       # lint(=strict tsc) + typecheck + test + build
```

首次启动自动执行：建 28 表 → 迁移 → 种入 4 个自有 SKU、4 个数据源、3 套规则档案、4 个演示 Research Job（draft）。

## 5. 如何初始化真实 4 SKU（V2.1 方式）

两种方式（均不补 0、缺失如实进队列）：

1. **手动录入**：`POST /api/owned-products`（独立创建，禁止走 development-projects；重复 sku/asin 返回 409），或 UI「数据任务」→ 手动录入。
2. **真实 SellerSprite ReverseASIN 文件**：`POST /api/import/sellersprite/reverse-asin`，body `{file_path, marketplace, asin, mode}`；32 列中文表头全映射，未知列进 mapping_queue；原始数据落 raw_ingestions/raw_records。
3. **Amazon 官方报表**：`POST /api/import/amazon/report`（report_type∈business/advertising/inventory/search_term/settlement）。

## 6. 如何启用真实 LLM（可选）

复制 `.env.example` 为 `.env` 并填写（V2.1 真实数据源凭据也见 `.env.example`）：

```
AI_ENABLED=true
AI_API_KEY=sk-xxx
AI_BASE_URL=https://api.openai.com/v1   # OpenAI 兼容接口可自定义
AI_MODEL=gpt-4o-mini
```

未配置时自动降级为确定性规则引擎（`model=rule-based-v1` 如实记录），结论与证据链照常产出。

## 7. 如何运行两个验收任务

服务启动后自动种入 4 个演示 Job（id 1-4，DEMO 模式）：

| Job | 类型 | 目标 | 状态流转 |
| --- | --- | --- | --- |
| 1 | existing_market | Memory Foam Pillow 市场 | → monitor_ready |
| 2 | owned_product | SKU-A 灰色枕头（**验收任务 A**） | → monitor_ready |
| 3 | adjacent_product | Memory Foam U-Shaped Pillow（**验收任务 B**） | → waiting_approval |
| 4 | new_opportunity | 小学一年级开学用品组合（任务 C，非阻塞） | → needs_data |

运行方式：UI「研究任务」页点运行，或 `POST /api/research-jobs/{1..4}/run`。

> 注意：**REAL 模式下**（`POST /api/system/mode {"mode":"REAL"}`）缺 Amazon 实际销量等真实数据时，任务转 **needs_data** 而非 Mock 兜底——这是 V2.1 的预期行为，录入真实数据后才会形成真实结论。

**验收任务 A 预期结果**（DEMO 模式）：SKU-A 判定为「🔴 明显跑输」—— 市场 30D +12.2%、SKU 30D +0.8%、相对表现 -11.4%，3 条证据带算式，置信度约 0.85。

**验收任务 B 预期结果**（DEMO 模式）：HardGate PASS → 评分 73.5（值得研究档）→ 评论缺口 + 反向审查 → 机会池 pending_review → UI 审批面板可批准 / 观察 / 拒绝，决策写入决策日志。

## 8. 测试结果（2026-09-12 全量通过）

```
npm run test → 37 项通过 / 0 失败（22 项 V2 + 9 项 V2.1 Red Team + 5 项 V2.2 HTTP Black Box + 1 容器）
npx tsc --noEmit → 0 error
```

覆盖：相对表现分级、HardGate 7 门、缺失数据不补 0、快照同日防覆盖、快照序列逐日写入（回归）、30 天窗口命中、证据引用完整性、状态机非法迁移拦截、审批落决策日志、拒绝保留现场、任务 A/B 整链路集成；V2.1 Red Team：REAL 禁 Mock fallback / Raw trace 穿透 / 未知列进 mapping_queue / 重复导入幂等 / 冲突并存 / 审批绕过 403 / HardGate 3 案例 / 恶意数据 / 关键字段映射正确率 100%；V2.2 HTTP Black Box：REAL+Sentinel → Evidence 987654 / REAL 无 Provider → needs_data 且无 Mock / 非法 approve → 403 / 未知字段 → mapping_queue / Amazon 缺失字段 → null+missing（详见 `V2_2_BLACKBOX_TEST_REPORT.md`）。

***

*本项目阶段：Architecture Prototype ✅ Complete · Real Data Integration 🚧 In Progress · Production Validation ⛔ Not Passed。真实数据接入（Amazon 官方凭据/报表、真实 4 SKU 录入、记忆棉真实文件）为后续输入项；V2.2 完成前 README 不标注 "Live Provider Connected"。*