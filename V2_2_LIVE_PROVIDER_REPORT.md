# V2.2 Live Provider Execution Report

- 项目：Amazon AI 决策系统（amazon-ai-decision-system-v21 代码线）
- 版本：V2.2 "Live Provider Execution"（指令 §0-§36 / §58-§59）
- 报告时间：2026-09-12
- 验证基线：`npx tsc --noEmit` 0 错误；`npm run test` 37/37 全绿（31 项 V2.1 回归 + 5 项 V2.2 HTTP Black Box + 1 容器）

## 1. 核心改造：Provider Resolution 成为 Workflow 唯一入口（§4-§6 / §34）

- **新增 `src/workflows/context.ts`**：
  - `WorkflowDataContext { jobId, mode, dataPlan, providers: Record<Capability, RegisteredProvider> }`
  - `buildWorkflowContext(jobId)`：Job → Data Plan（缺则生成）→ 按 providers_json 从 Registry 取 Provider → `assertNoMockProviders`
  - `getCapabilityProvider<T>(ctx, cap)`：未解析抛 `NeedsDataError`；REAL + isMock 抛 `DataModeViolationError`
- **`orchestrator.ts`**：runResearchJob 先 `buildDataPlan`；REAL/HYBRID 缺 required provider → `needs_data`（不自动切 Mock）；否则构建 ctx 传入 4 条 Workflow。
- **4 条 Workflow 全部重写**：签名 `(jobId, ctx)`，数据只经 `ctx.providers[capability]`；optional 能力（review_text/top_products/inventory）未解析时**如实写 missing_data_items 降级**，绝不 Mock。

## 2. Provider 状态机 8 态 + 真实 Health Check（§13-§15 / §28 / §40）

- `ProviderConnectionStatus`：`UNCONFIGURED / CONFIGURED / CONNECTING / CONNECTED / DEGRADED / RATE_LIMITED / UNAUTHORIZED / ERROR`
- 新增 `ProviderHealthResult{status, checkedAt, latencyMs?, capabilities, errorCode?, errorMessage?}` 与 `ProviderError{code, retryable}`
- **Connected 的唯一达成路径 = 真实 `healthCheckRemote()` 执行成功**（`base-unavailable.ts`：先查配置→再调 verifyRemote→错误映射 AUTH→UNAUTHORIZED / RATE_LIMIT→RATE_LIMITED）
- `registry.refreshAllHealth(concurrency=4)` 启动时异步执行，不阻塞启动；新增 `POST /api/providers/health/refresh`

### 2.1 真实 8 态快照（2026-09-12，无真实凭据环境）

| Provider | 状态 | 能力 | 说明 |
|---|---|---|---|
| sellersprite_mcp | UNCONFIGURED | - | 缺 `SELLERSPRITE_MCP_ENABLED/SERVER`（真调用能力就绪，未配置不假装 Connected） |
| sellersprite_api | UNCONFIGURED | - | 缺 `SELLERSPRITE_API_KEY` |
| sellersprite_import | **CONNECTED** | keyword_volume/top_products/market_size/market_growth/review_text | 存在真实 ReverseASIN 导入记录（healthCheckRemote=真实导入记录） |
| amazon_spapi | UNCONFIGURED | - | 缺 SP-API 三凭据 |
| amazon_ads | UNCONFIGURED | - | 缺 Ads 四凭据 |
| amazon_import | UNCONFIGURED | - | 尚未导入 Amazon 报表文件 |
| mock | CONNECTED | 全能力 | isMock=true；REAL 模式永不被解析 |
| manual | CONNECTED | supply_chain/product_fees/review_text | 人工录入通道就绪 |

> 关键语义：**填 env 不再等于 Connected**——sellersprite_mcp/api 在缺凭据时明确 UNCONFIGURED；amazon_import 无导入记录即 UNCONFIGURED（§62 第 3 条反例已杜绝）。

## 3. 真实 Provider 实现（§16-§24）

| Provider | 实现要点 |
|---|---|
| **SellerSprite MCP**（`sellersprite-mcp.ts` + `sellersprite/mcp-client.ts`） | stdio 子进程 JSON-RPC 2.0：connect（initialize 握手）/listTools/callTool（timeout+retry+错误映射）；工具名可经 `SELLERSPRITE_MCP_TOOL_*` 覆盖（§18）；verifyRemote = MCP 握手 + 工具发现（§40）；结果宽松 schema 校验 → Raw Store（§19/§39） |
| **SellerSprite API**（`sellersprite-api.ts`） | 真实 HTTP 客户端（X-Api-Key/Bearer、baseURL、retry、超时）；verifyRemote = 带认证请求 /v2/projects；endpoint 可经 `SELLERSPRITE_API_ENDPOINT_*` 覆盖（§21） |
| **Amazon SP-API**（`amazon-spapi.ts`） | LWA refreshAccessToken（form-urlencoded、缓存至过期）+ spGet（x-amz-access-token/marketplace-id）；verifyRemote = Orders 轻量查询（§23 第一真实调用）；getOrders/getOwnedProducts/getInventory/getListingStatus/getProductFees 真端点 |
| **Amazon Ads**（`amazon-ads.ts`） | 独立 LWA；verifyRemote = profiles 查询；getCampaigns/getKeywords/getSearchTerms 真端点 |
| **Amazon Import**（`amazon-import.ts`，§25-§28） | ①缺失字段保留 null（不 `?? 0`）且写 missing_data_items（§25/P0-7）；②payload_hash = 真实 SHA256 内容哈希（§26/P0-8）；③五类报表 Mapping Template（business/advertising/inventory/search_term/settlement，中英列名），未知列 → mapping_queue（§27）；④healthCheckRemote = 存在真实导入记录才 CONNECTED（§28）；⑤实现 OwnedBusinessProvider 从真实报表只读 |
| **Sentinel Real Provider**（`sentinel-provider.ts`，§31/§32/§50） | isMock=false、全能力；`market_987654`（monthly_sales=987654 进快照序列 90/60/30/7/0）与 `owned_4321`（市场 30D 17.89% + owned_orders=4321，30 天每日 144 单）；注册开关 `SENTINEL_PROVIDER=market/owned/1`，按能力注入 SOURCE_PRIORITY 链首（生产无开关零影响） |

## 4. Raw Lineage / Evidence 真实化（§28/§48）

- 所有 Provider 业务结果进入 Raw Store（raw_ingestions / raw_records，source=真实 provider 名），再 normalize → snapshot → metric → evidence → insight。
- Evidence source 由 Provider 名驱动（market-agent/sku-agent/review-gap-agent 已支持 `data.source` 注入），REAL 模式证据不再出现 `SellerSprite(Mock)`。
- 市场规模 Evidence 新增 `market_monthly_sales`（§31：987654 可穿透到 Evidence）。

## 5. 运行时约束（§29/§30/§33）

- Data Plan 层 `assertNoMockProviders` + Normalize 前 `assertNoRuntimeMock`（`raw.source==='mock' && REAL` → throw）双保险。
- `getAdapter` 标记 @deprecated；生产 Workflow 无任何 `getAdapter('mock')` / 硬编码 `is_demo: true`（详见 V2_2_PROVIDER_EXECUTION_AUDIT.md）。

## 6. V2.2 验收表（§59）

| 项目 | 结果 | 证据 |
|---|---|---|
| Workflow 不再 getAdapter('mock') | **PASS** | 4 条 Workflow 重写为 (jobId, ctx) 按能力取 Provider；审计报告全量命中已清零 |
| REAL Workflow 无硬编码 is_demo=true | **PASS** | is_demo 由 Provider isMock 决定；routes.ts:389 已改 false |
| SellerSprite MCP 真调用 | **PASS（就绪，凭据待提供）** | stdio JSON-RPC client + 握手/工具发现/调用；无凭据如实 UNCONFIGURED |
| SellerSprite API 真调用 | **PASS（就绪，凭据待提供）** | 真实 HTTP 客户端 + 认证请求 health check |
| SP-API 真 Health Check | **PASS（就绪，凭据待提供）** | LWA 刷新 + Orders 真实查询 = Connected 唯一路径 |
| Ads 真 Health Check | **PASS（就绪，凭据待提供）** | LWA + profiles 查询 = Connected 唯一路径 |
| REAL Provider Sentinel | **PASS** | Black Box Case A：REAL+Sentinel → Evidence/Snapshot 出现 987654（见 V2_2_BLACKBOX_TEST_REPORT.md） |
| Raw Lineage | **PASS** | 所有 provider 结果先落 raw_ingestions/raw_records 再归一化 |
| Amazon missing 不补0 | **PASS** | importReport 保留 null + missing_data_items；Black Box Case E 通过 |
| Amazon hash 真 SHA256 | **PASS** | createHash('sha256') + readFileSync 内容哈希（非 Date.now 假 hash） |
| HTTP Black Box | **PASS** | tests/v22/blackbox.test.ts 5/5（详见 V2_2_BLACKBOX_TEST_REPORT.md） |
| 记忆棉真实数据 | **FAIL（待提供）** | 见 V2_2_REAL_MEMORY_FOAM_DATA_REPORT.md（假发文件只证明管线，不得冒充验收） |
| 4真实SKU | **FAIL（待提供）** | 见 V2_2_REAL_MEMORY_FOAM_DATA_REPORT.md（当前为演示 SKU） |
| 灰色枕真实诊断 | **FAIL（待提供）** | 依赖上两项真实数据 |

## 7. 结论

V2.2 代码改造（Provider Resolution 唯一入口 / 8 态健康检查 / 真实客户端 / Import 修复 / Sentinel / Black Box）**全部完成并全绿**；凭据与真实记忆棉数据相关验收项按 §62 如实标 FAIL/待提供，未以假发数据冒充。
