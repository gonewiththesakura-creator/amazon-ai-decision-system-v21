# V2.2 Provider Execution Audit（Step 1：全局 Mock 审计）

- 项目：Amazon AI 决策系统（amazon-ai-decision-system-v21 代码线）
- 指令：`Amazon_AI决策系统_V2.2_LiveProvider修复指令.md` §63 Step 1 / §58
- 审计时间：2026-09-12（V2.2 改造完成态）
- 审计方式：全源码 Grep `getAdapter(` / `is_demo: true` / `is_demo:true` / `source: 'SellerSprite(Mock)'` / `source: 'Review(Mock)'`

## 1. 生产 Workflow 硬编码 Mock 审计（§61 C/D）

### 1.1 getAdapter('mock') 全量命中

| 位置（改造前） | 用途 | V2.2 处理 |
|---|---|---|
| `src/workflows/existing-market.workflow.ts:58` | 市场概览/TOP 产品数据 | **已删除**：改为 `ctx.providers['market_size'/'top_products']` 按能力取 Provider（§7） |
| `src/workflows/owned-product.workflow.ts:29` | SKU 详情/订单数据 | **已删除**：改为 `ctx.providers['owned_orders'/'market_growth'/'top_products']`（§8/§9） |
| `src/workflows/adjacent-product.workflow.ts:75` | 相邻品类研究 | **已删除**：改为 `ctx.providers['market_size'/'top_products']`（§10 语义） |
| `src/workflows/new-opportunity.workflow.ts:33` | 新机会研究 | **已删除**：改为 `ctx.providers['market_size']`（optional 能力未解析时如实降级） |

### 1.2 is_demo: true 硬编码全量命中

| 位置（改造前） | 用途 | V2.2 处理 |
|---|---|---|
| `existing-market.workflow.ts:110-111` | normalize 时标 demo | **已删除**：`is_demo` 由 `marketCtx.isMock`（Provider 自身属性）决定（§12） |
| `owned-product.workflow.ts:74/76/82` | normalize 时标 demo | **已删除**：由 `ownedCtx/marketCtx/topCtx.isMock` 决定 |
| `adjacent-product.workflow.ts:138-140` | normalize 时标 demo | **已删除**：由 `marketCtx.isMock` 决定 |
| `new-opportunity.workflow.ts:88-89` | normalize 时标 demo | **已删除**：由 `marketCtx.isMock` / `topCtx?.isMock` 决定 |
| `src/api/routes.ts:389` | 旧 `/import/csv` 演示端点 | **已修复**：`is_demo: true` → `is_demo: false`（CSV 导入为真实数据，不应标 Mock；非生产主链路） |

### 1.3 Agent 证据 source 硬编码审计（V2.2 新增覆盖，§12）

| 位置 | 改造前 | V2.2 处理 |
|---|---|---|
| `src/ai/agents/market-agent.ts:27` | `source: 'SellerSprite(Mock)'` | 改为 `data.source ?? 'SellerSprite(Mock)'`；existing_market workflow 传入 `marketCtx.name`（真实 Provider 名） |
| `src/ai/agents/sku-agent.ts:35` | `source: 'SellerSprite(Mock)'` | 同上；owned_product workflow 传入 `ownedCtx+marketCtx+topCtx` 名 |
| `src/ai/agents/review-gap-agent.ts:95/113` | `source: 'Review(Mock)'` | 改为 `data.source ?? 'Review(Mock)'`；adjacent_product workflow 传入 review provider 名 |
| `src/ai/agents/reverse-review-agent.ts:44` | `'ReverseReview(rule-based)'` | 保留（规则计算名，非数据源 Mock） |

### 1.4 合理保留（非生产 Mock）

| 位置 | 原因 |
|---|---|
| `src/seed/seed-demo.ts`（`is_demo: true` 于 rule profile JSON） | 演示播种数据，仅测试/首次演示 |
| `src/adapters/providers/mock-provider.ts` | Mock Provider 本体（isMock=true）；REAL 模式 registry 永不解析到它（§29） |
| `src/adapters/mock/mock-adapter.ts` | V1 legacy 适配器（`getAdapter` 已标 @deprecated，§33） |

## 2. 结论

- 生产 Workflow（existing-market / owned-product / adjacent-product / new-opportunity）**已无** `getAdapter('mock')`（§61 C PASS）。
- 生产 Workflow **已无** 硬编码 `is_demo: true`（§61 D PASS）。
- Evidence source 已由 Provider 名驱动，REAL 模式证据不再出现 `SellerSprite(Mock)`（§12 PASS）。
- `getAdapter` 已标记 `@deprecated`（§33，仅 DEMO legacy 测试使用）。

## 3. 双保险（§29/§30）

- Data Plan 层：`assertNoMockProviders(ctx)` —— REAL 模式下 resolved providers 含 isMock=true 直接抛 `DataModeViolationError`（`src/workflows/context.ts`）。
- Normalize 前 Runtime Mock Guard：`assertNoRuntimeMock(raw, getMode())` —— `mode==='REAL' && raw.source==='mock'` 直接抛错（`src/normalization/engine.ts`）。
