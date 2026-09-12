# Amazon 官方数据接入状态报告（AMAZON_INTEGRATION_STATUS）

> 依据 V2.1 核心原则"Amazon 官方优先于第三方估算"、§16（SP-API）、§17（自有数据录入）、§44（Amazon 报表导入）
> 报告日期：2026-09-11 · 当前状态：**接口与数据模型就绪，凭据未配置**

## 1. 结论

Amazon 官方数据通道（SP-API / Ads / 报表导入）已完成**接口、数据模型、错误处理**落地，但**凭据/真实报表未提供**，因此：
- 相关 Provider 如实标注 **Unauthorized**（不是假 Connected）；
- REAL 模式下依赖 Amazon 数据的任务转 **needs_data**，绝不使用 Mock 兜底；
- 自有真实数据（4 SKU）尚未录入 Amazon 实际销量 → 覆盖度 owned_sales = **MISSING**。

## 2. 各通道现状

| 通道 | Provider | 状态 | 已落地 | 阻塞 |
|---|---|---|---|---|
| SP-API 订单/库存 | amazon_spapi | Unauthorized | 能力接口 owned_orders / inventory / listing_status / product_fees / estimated_sales；OAuth 凭据校验；NeedsDataError | 缺 CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN |
| Ads 广告指标 | amazon_ads | Unauthorized | ad_metrics / search_terms 能力；凭据校验 | 缺 CLIENT_ID / SECRET / REFRESH_TOKEN / PROFILE_ID |
| 报表文件导入 | amazon_import | Unauthorized | POST /api/import/amazon/report（business/advertising/inventory/search_term/settlement 五类） | 未收到真实报表文件 |
| 自有 SKU 录入 | —（owned_products API） | ✅ 已通 | POST /api/owned-products 独立创建（§17，禁止走 development-projects，重复 sku/asin 409） | 4 个真实 SKU 的 ASIN/店铺/成本/库存需用户提供 |

## 3. 为什么设计为"未授权即阻塞"

- Provider 未配置凭据 → `getStatus()` 返回 Unauthorized，`healthCheck()` 返回空能力集；
- REAL 模式 `registry.resolveForCapability('owned_orders')` → 抛 `NeedsDataError` → orchestrator 记录 missing_data_items 并转 needs_data；
- 演示数据（Mock）被 Provider 层显式标记 `isMock=true`，REAL 模式 resolve 跳过 —— **架构上保证不会把估算/演示冒充官方真实数据**。

## 4. 数据优先级（§7，已实现 source-priority.ts）

```
owned_orders / inventory / ad_metrics（Amazon 官方，REAL） 
  > SellerSprite 导入快照（ESTIMATED，第三方估算，明确标记）
  > 人工录入（manual）
  > Mock（仅 DEMO/HYBRID）
```

## 5. 完成"真实 4 SKU 跑通"所需输入

按 V2.1 第一阶段完成标志（4 个真实 SKU 能跑），需要用户提供：

1. **4 个自有 SKU 信息**：ASIN、店铺名、站点（如 US/MX）、成本价、当前库存；
2. **Amazon 官方数据任选其一**：
   - SP-API 凭据（Client ID / Secret / Refresh Token），或
   - 后台导出的业务报表文件（如 Reports API 的 GET_ORDER_REPORT / 库存报告），走 `POST /api/import/amazon/report`；
3. **（可选）Ads 凭据**：用于广告指标校准。

> 提供后即可：录入自有 SKU → 导入 Amazon 实际销量 → 覆盖度 owned_sales 转 REAL → 真实诊断"灰色枕跑输" → 与 SellerSprite 估算做校准（Bias/MAPE）。

## 6. 复算命令

```powershell
GET /api/providers/status            # amazon_spapi / amazon_ads / amazon_import = Unauthorized（如实）
POST /api/owned-products             # 录入自有 SKU（重复 409）
POST /api/import/amazon/report       # 导入 Amazon 报表（report_type∈business/advertising/inventory/search_term/settlement）
GET /api/dashboard/coverage          # owned_sales 由 MISSING → REAL
```
