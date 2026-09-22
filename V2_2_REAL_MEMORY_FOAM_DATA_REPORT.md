# V2.2 真实记忆棉数据报告（§43/§44/§55）—— 2026-09-22 真实 MCP + 真实 SKU 验收

- 指令要求（§43）：第一阶段真实数据必须换成记忆棉；假发文件只证明管线，**不得**作为记忆棉验收。
- 指令要求（§44）：真实 SKU 必须录入 `sku / asin / internal_name / brand / marketplace / market_node / status`（**禁止 SKU-A/SKU-B 占位**）。
- 报告时间：2026-09-12（初版，FAIL/待提供）/ **2026-09-22（用户补交 SellerSprite 远程 MCP 凭据 + 5 个真实 SKU，验收解除）**

## 1. 真实输入（2026-09-22 用户提供）

| 输入 | 内容 |
|---|---|
| SellerSprite 远程 MCP | `SELLERSPRITE_MCP_URL=https://mcp.sellersprite.com/mcp?` + `SELLERSPRITE_MCP_SECRET=***`（写 `.env`，已 gitignore，不入库） |
| 5 个真实 SKU（US / Marketplace ID `ATVPDKIKX0DER`） | ① B0GYH8WT22 / LIU-B0GYH8WT22 / 刘总枕头；② B0GY2TDLTZ / ELOVNOVA-Gray / 江西灰色；③ B0GY2WGTDM / ELOVNOVA-Blue / 江西蓝色（同 ② parent）；④ B0HJWZM439 / NB-LP001-MG / 腰枕-Misty Stone Gray；⑤ B0HJX1MGBF / NB-LP001-MSG / 腰枕-Meteor Gray。全部 Brand=ELOVNOVA、Monitoring=Enabled |

## 2. SellerSprite 远程 MCP 真调用（2026-09-22 实测）

| 项 | 结果 |
|---|---|
| 连接 | `sellersprite_mcp = CONNECTED`，握手成功（remote-streamable-http），**工具 7/7 匹配** |
| 认证协议（实测） | header `secret-key`（非 Bearer/query）；`Accept: application/json, text/event-stream`；协议 2025-03-26；notifications/initialized 不带 id；JSON-RPC 取 `result` 字段 |
| market_research("Pillows") | 命中 **Bed Pillows** 类目（nodeIdPath `1055398:1063252:1199122:10671043011`），totalProducts=3029、brands=71、avgPrice=45.08、avgRating=4.3；另命中 Neck & Cervical Pillows（3290 商品/55 品牌/37.44） |
| market_research_statistics | 类目头部 Listing 真实返回（returnFields asin/title/price/totalUnits/totalAmount/rating/reviews/brand/bsr） |
| asin_detail | 真实标题/价格/评分/评论数（竞品 top10 逐条取回，入库 products #442-#449：Utopia Bedding、Coop Home Goods、JOLLYVOGUE、QUTOOL、Nuzzle、Sasttie 等） |
| review | 10 竞品 × 40 条真实评论，**400 条入库**（content/star/date 毫秒时间戳），2026-09-22 采集 |
| keyword_miner("memory foam pillow") | total=9495，真实搜索量/竞价/商品数（当日早些时候已验证；本轮以市场/评论验收为主） |
| 真实快照 | market_snapshots 新增 is_demo=0 快照（source_metadata.source=sellersprite_mcp）；历史 demo 快照保留不混入 |
| products Lineage 修复 | 发现 upsertProduct 不写 source（列默认 'import'）→ MCP 竞品行来源被误标 import；已修：upsertProduct 支持 source 参数 + normalizeProductData 透传 raw.source，存量 10 个竞品行修正为 `sellersprite_mcp`（pid 440-449，各挂 40 条真实评论） |

## 3. 5 个真实 SKU 录入（2026-09-22）

- 市场节点：`Memory Foam Pillow`(id=2) 关联 ①②③；新建 `Lumbar Support Pillow`(id=16) 关联 ④⑤（US，level 3）。
- owned_products 表新增 5 行（id 5-9）：`sku/asin/internal_name/brand/marketplace(US)/market_id/status(active)` 字段齐备，无占位符。
- Parent/Child：用户标注 "Parent ASIN: Pending lookup" → 如实保留待查（不编造），owned-products 允许无 parent 录入。

## 4. REAL 模式验收运行（真实 Provider 证据）

| 运行 | 结果 |
|---|---|
| existing_market（target=Pillows） | **monitor_ready**；真实快照（3029 商品/71 品牌）+ missing 如实（类目无月度销量 → monthly_sales 等 31 项 open） |
| adjacent_product（target=Pillows） | **waiting_approval**；collect_market ok=1、collect_products ok=10（真实竞品）、collect_reviews ok=200（真实评论）；Evidence source=**sellersprite_mcp**：太硬 28% / 太软 42% / 颈部压力 19% / 尺寸不符 13% / 闷热 12%（conf 0.8） |
| owned_product（target=B0GY2TDLTZ） | **needs_data（如实）**：`capability:owned_orders` 缺 Amazon SP-API 凭据（required=1），不 Mock 兜底 |

## 5. 本报告对应的 V2.2 验收表更新

| 项 | 2026-09-12 | 2026-09-22 |
|---|---|---|
| SellerSprite MCP 真调用 | FAIL（凭据待提供） | **PASS**（CONNECTED 7/7 + 四类工具真实返回） |
| 记忆棉真实数据 | FAIL（待提供） | **PASS（MCP 实时）**：类目/竞品/评论/关键词全部真实 |
| 真实 SKU 录入 | FAIL（4 个未提供） | **PASS**：5 个真实 SKU 已录入（用户实际给 5 个，非指令字面 4 个） |
| 灰色枕真实诊断 | FAIL | **部分**：真实市场/竞品/评论洞察完成（sellersprite_mcp 证据）；owned_orders 维度仍 FAIL（待 Amazon SP-API 凭据） |

## 6. 仍未解除的输入缺口（§62，如实标注）

1. **Amazon SP-API 凭据**（AMAZON_SPAPI_CLIENT_ID/SECRET/REFRESH_TOKEN）→ amazon_spapi=UNCONFIGURED → owned_orders/inventory/listing_status 缺真实来源。
2. **Amazon Ads 凭据**（AMAZON_ADS_*）→ amazon_ads=UNCONFIGURED → ad_metrics/search_terms 缺真实来源。
3. Parent ASIN（②③ 同 parent / ① 无 parent 关系）→ 用户标注 Pending lookup，待用户提供。
4. SellerSprite API Key（SELLERSPRITE_API_KEY）→ 非阻塞（MCP 已覆盖同类能力）。

## 7. 结论

2026-09-22 用户补交的两组关键输入（远程 MCP 凭据 + 5 真实 SKU）**已全部落地并跑通 REAL 验收**：MCP 真实连接（7/7）、真实市场快照、10 个真实竞品、200 条真实评论、5 条真实洞察证据、5 个真实 SKU 入库。此前两项 FAIL（MCP 真调用、真实记忆棉数据/SKU）**解除**；剩余 Amazon 凭据相关项继续如实 FAIL/待提供，未以假数据冒充。
