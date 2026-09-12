# SellerSprite 真实文件映射验收报告（SELLERSPRITE_MAPPING_REPORT）

> 依据 V2.1 §10（ReverseASIN 导出映射）、§12（测试 1：真实文件导入）、§40（未知列禁止静默丢弃）
> 报告日期：2026-09-11

## 1. 验收结论

- 4 个真实 ReverseASIN 导出 xlsx（假发类目，2026-08-20 快照）全部解析成功；
- **32 列中文表头全部映射**，未映射列 = 0，mapping_queue 为空；
- 编码/格式兼容：UTF-8 BOM、UTF-8、GBK（CSV）、MX 货币符号、千分位逗号、百分号均正确处理；
- 关键字段映射正确率 100%（对账 DIFFERENT=0）。

## 2. 32 列中文表头 → 标准字段映射表

映射定义见 `src/adapters/providers/import-engine.ts`（`REVERSE_ASIN_COLUMN_MAP`），落库 `normalization_mappings` 可追溯：

| # | 源列（中文表头） | 标准字段 | 类型 | 入库目标 |
|---|---|---|---|---|
| 1 | 流量词 | keyword | text | keywords.keyword |
| 2 | 关键词翻译 | keyword_translation | text | raw（source_metadata） |
| 3 | AC推荐词 | ac_recommended_keyword | text | raw（source_metadata） |
| 4 | 流量占比 | traffic_share | numeric | keyword_snapshots.traffic_share |
| 5 | 预估周曝光量 | estimated_weekly_impressions | numeric | raw（source_metadata） |
| 6 | 关键词类型 | keyword_type | text | raw（source_metadata） |
| 7 | 转化效果 | conversion_effect | text | raw（source_metadata） |
| 8 | 流量词类型 | traffic_type | text | raw（source_metadata） |
| 9 | 自然流量占比 | organic_traffic_share | numeric | raw（source_metadata） |
| 10 | 广告流量占比 | ad_traffic_share | numeric | raw（source_metadata） |
| 11 | 自然排名 | organic_rank | numeric | raw（source_metadata） |
| 12 | 自然排名页码 | organic_rank_page | numeric | raw（source_metadata） |
| 13 | 更新时间 | updated_at | text | raw（source_metadata） |
| 14 | 广告排名 | ad_rank | numeric | raw（source_metadata） |
| 15 | 广告排名页码 | ad_rank_page | numeric | raw（source_metadata） |
| 16 | ABA周排名 | aba_weekly_rank | numeric | keyword_snapshots.aba_weekly_rank |
| 17 | 月搜索量 | search_volume | numeric | keyword_snapshots.search_volume |
| 18 | SPR | spr | numeric | raw（source_metadata） |
| 19 | 标题密度 | title_density | numeric | raw（source_metadata） |
| 20 | 购买量 | purchases | numeric | keyword_snapshots.purchases |
| 21 | 购买率 | purchase_rate | numeric | keyword_snapshots.purchase_rate |
| 22 | 展示量 | impressions | numeric | keyword_snapshots.impressions |
| 23 | 点击量 | clicks | numeric | keyword_snapshots.clicks |
| 24 | 商品数 | product_count | numeric | keyword_snapshots.competing_products |
| 25 | 需供比 | supply_demand_ratio | numeric | raw（source_metadata） |
| 26 | 广告竞品数 | ad_competitors | numeric | raw（source_metadata） |
| 27 | 点击总占比 | click_share | numeric | keyword_snapshots.aba_click_share |
| 28 | 转化总占比 | conversion_share | numeric | keyword_snapshots.aba_conversion_share |
| 29 | PPC价格 | ppc_price | numeric | raw（source_metadata） |
| 30 | 建议竞价范围 | suggested_bid_range | text | raw（source_metadata） |
| 31 | 前十ASIN | top10_asins | text | raw（source_metadata） |
| 32 | （文件自带备注列） | — | — | raw（raw_payload 全量保留） |

> 说明：非核心对账字段（翻译/排名/SPR/PPC 等）随 raw_payload 全量留存（不丢数据），标准库保留对账与决策必需的核心指标列。

## 3. 数值清洗规则（实测验证）

| 输入形态 | 输出 | 说明 |
|---|---|---|
| `NA` / `N/A` / `-` / 空 / `null` | null | 空值统一（MISSING 如实标记，不伪造 0） |
| `$39.99` / `MX$0.02` | 39.99 / 0.02 | 货币符号剥离 |
| `39,99` | 39.99 | 欧式千分位逗号转小数点 |
| `12%` | 12 | 百分号剥离（保留数值语义） |
| `1,234` | 1234 | 千分位（美式） |
| 负数 / 超大值 | 原样数值 | 由下游 Hard Gate 判定（测试验证不崩） |

## 4. 导入统计（实测）

| ASIN | 站点 | 行数 | 映射列 | 未映射列 | 重复关键词 |
|---|---|---|---|---|---|
| B0BYP8MCVG | MX | 24 | 32 | 0 | 0 |
| B0FDJMGSWJ | MX | 28 | 32 | 0 | 9 |
| B0GSSXNVRC | MX | 18 | 32 | 0 | 13 |
| B0FL7FX7T1 | US | 43 | 32 | 0 | 0 |
| **合计** | | **113** | **32** | **0** | 22 |

## 5. 对账正确率（§12-4 验收）

- 关键字段（月搜索量、商品数）映射正确率：**100%**（DIFFERENT=0；商品数 43/43 全 MATCH）；
- 全字段对账：MATCH=200 / DIFFERENT=0 / MISSING=15（源文件空值）/ TRANSFORMED=0；
- 未映射列机制：若未来出现新列（如"父体销量"），自动进 `mapping_queue`，API `POST /api/mapping-queue/:id/resolve` 可补映射，**禁止静默丢弃**（Red Team 测试覆盖）。

## 6. 复算命令

```powershell
GET  /api/mapping-queue                 # 期望空（0 未映射列）
GET  /api/imports                       # 4 个真实批次
POST /api/reconciliation/run            # {"ingestion_id":<最新批次>} → DIFFERENT=0
```
