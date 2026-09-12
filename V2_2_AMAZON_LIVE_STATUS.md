# V2.2 Amazon Live Status（§55/§56/§62）

- 指令要求：Amazon SP-API 与 Ads 必须**真实 Health Check**（Connected ≠ env 填齐，必须真实 HTTP 调用成功）。
- 报告时间：2026-09-12

## 1. 实现状态（代码层已完成并全绿）

### Amazon SP-API（`src/adapters/providers/amazon-spapi.ts`）
- LWA `refreshAccessToken`：form-urlencoded 换取 access_token，缓存至过期。
- `spGet`：携带 `x-amz-access-token` + `marketplace-id` 调用真实端点。
- `verifyRemote`（§23 第一真实调用）：真实请求 `GET /orders/v0/orders`（轻量查询）——**成功才 CONNECTED**。
- 能力：`getOrders`（orders/v0/orders + orderItems）、`getOwnedProducts`（Listings Items）、`getInventory`、`getListingStatus`、`getProductFees`（Fees API）。

### Amazon Ads（`src/adapters/providers/amazon-ads.ts`）
- 独立 LWA（client_id/secret/refresh_token）。
- `verifyRemote`：真实请求 profiles 列表——**成功才 CONNECTED**。
- 能力：`getCampaigns` / `getKeywords` / `getSearchTerms` 真实端点。

### Amazon Import（`src/adapters/providers/amazon-import.ts`）
- 真实报表导入（business/advertising/inventory/search_term/settlement）；缺失字段保留 null；SHA256 内容哈希；未知列 → mapping_queue；healthCheckRemote = 存在真实导入记录才 CONNECTED。

## 2. 当前凭据状态（2026-09-12 实测）

`POST /api/providers/health/refresh` 实测结果：

| Provider | 状态 | 缺失配置 |
|---|---|---|
| amazon_spapi | **UNCONFIGURED** | `AMAZON_SPAPI_CLIENT_ID` / `AMAZON_SPAPI_CLIENT_SECRET` / `AMAZON_SPAPI_REFRESH_TOKEN` |
| amazon_ads | **UNCONFIGURED** | `AMAZON_ADS_CLIENT_ID` / `AMAZON_ADS_CLIENT_SECRET` / `AMAZON_ADS_REFRESH_TOKEN` / `AMAZON_ADS_PROFILE_ID` |
| amazon_import | **UNCONFIGURED** | 尚未导入 Amazon 报表文件（可替代 SP-API 走通 Amazon Actual 数据） |

> 关键：未配置时明确 UNCONFIGURED（并给出缺失项），**绝不显示 Connected**——§62 反例 3「填环境变量即显示 Connected」已杜绝。

## 3. 需要用户提供（任选其一或全部）

- **方案 A（SP-API）**：`AMAZON_SPAPI_CLIENT_ID`、`AMAZON_SPAPI_CLIENT_SECRET`、`AMAZON_SPAPI_REFRESH_TOKEN`（可选 `SELLER_ID` / `REGION` / `MARKETPLACE_ID`）。
- **方案 B（报表导入）**：真实 Amazon 业务/库存报表文件（走 amazon_import 即可满足 §61 G「Import 或 SP-API 其中一种真实方式」）。
- **Ads**：`AMAZON_ADS_CLIENT_ID` / `AMAZON_ADS_CLIENT_SECRET` / `AMAZON_ADS_REFRESH_TOKEN` / `AMAZON_ADS_PROFILE_ID`。

## 4. 结论

SP-API / Ads 真客户端与真 Health Check **代码完成、tsc 绿、无凭据时如实 UNCONFIGURED**；当前验收状态 = **FAIL（待提供凭据或报表文件）**。提供任一真实通道后即可直接验收。
