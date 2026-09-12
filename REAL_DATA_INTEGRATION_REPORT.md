# V2.1 真实数据集成验收报告（REAL_DATA_INTEGRATION_REPORT）

> 依据《Amazon_AI决策系统_V2.1_真实数据优先实施指令》P0-1 / §12 / §14 / §42 / §53 验收
> 报告日期：2026-09-11 · 项目状态：**REAL_DATA_INTEGRATION**

## 1. 验收结论摘要

| 验收项 | 结果 | 证据 |
|---|---|---|
| P0-1 真实 SellerSprite 文件导入 | ✅ 通过 | 4 个真实 ReverseASIN xlsx 导入成功，113 行原始数据，32 列全映射、0 未映射列 |
| Raw 数据留存 | ✅ 通过 | raw_ingestions / raw_records 双表留存，含源文件、哈希、行级原始 payload |
| Evidence 全链穿透 | ✅ 通过 | Insight→Metric→Snapshot→Normalized→Raw→Ingestion→Source 全链，测试断言 integrity ok |
| Data Reconciliation 对账 | ✅ 通过 | 200 MATCH / 0 DIFFERENT / 15 MISSING（全部为源数据空值如实标记）；关键字段正确率 100% |
| REAL 禁 Mock | ✅ 通过 | REAL 模式缺能力 → job 转 needs_data，绝不 fallback Mock（含 missing_data_items 落库） |
| 审批不可绕过 | ✅ 通过 | 非法状态 approve 返回 403 APPROVAL_BYPASS_BLOCKED |
| Red Team 对抗 | ✅ 通过 | 9 项测试全绿（含硬门槛、恶意数据、映射正确率） |
| 覆盖度面板 | ✅ 通过 | GET /api/dashboard/coverage 逐域标注 REAL/ESTIMATED/PARTIAL/MISSING |

## 2. 真实数据导入（P0-1）

4 个 SellerSprite ReverseASIN 导出文件（假发类目，2026-08-20 快照）全部导入成功：

| ASIN | 站点 | 行数 | 映射列 | 未映射列 | 重复关键词 |
|---|---|---|---|---|---|
| B0BYP8MCVG | MX | 24 | 32 | 0 | 0 |
| B0FDJMGSWJ | MX | 28 | 32 | 0 | 9 |
| B0GSSXNVRC | MX | 18 | 32 | 0 | 13 |
| B0FL7FX7T1 | US | 43 | 32 | 0 | 0 |
| **合计** | | **113** | **32** | **0** | 22（跨文件重叠，正确去重） |

- 重复关键词处理：跨 ASIN 重叠的 22 个流量词不重复创建 keyword 记录；
- 同日快照幂等：重复导入同一文件按 (keyword, date) 覆盖更新，不产生重复快照行（重导 dup=24/28/18/43 全部命中已有 keyword）；
- 未知列：0 列进入 mapping_queue（32 列全部命中映射表）；若出现未知列将进入 queue 并可在 UI/API 查看，禁止静默丢弃。

## 3. Raw 数据留存

- `raw_ingestions`：每次导入 1 行（source、source_type、source_file、row_count、file_hash、mode、marketplace、asin、created_at）；
- `raw_records`：每行原始数据 1 条（ingestion_id、row_index、raw_payload JSON 原文），原始数值/文本逐字保留；
- 归一化映射落 `normalization_mappings`（来源列 → 标准字段 → 转换规则），可追溯。

## 4. Provider 状态（§14，如实标注）

| Provider | 状态 | 说明 |
|---|---|---|
| sellersprite_import | **Connected** | 真实导出文件导入通道，已生效 |
| sellersprite_mcp | Unauthorized | 缺少 SELLERSPRITE_MCP_ENABLED / SELLERSPRITE_MCP_SERVER |
| sellersprite_api | Unauthorized | 缺少 SELLERSPRITE_API_KEY |
| amazon_spapi | Unauthorized | 缺少 AMAZON_SPAPI_CLIENT_ID / SECRET / REFRESH_TOKEN |
| amazon_ads | Unauthorized | 缺少 AMAZON_ADS_CLIENT_ID / SECRET / REFRESH_TOKEN / PROFILE_ID |
| amazon_import | Unauthorized | 尚未导入 Amazon 报表文件 |
| manual | Connected | 人工录入通道 |
| mock | Connected | **Mock 显式标注，REAL 模式禁止使用** |

## 5. Data Reconciliation 对账（§22）

最新真实批次（US B0FL7FX7T1，43 行，215 条逐字段对账）结果：

```
MATCH=200  DIFFERENT=0  MISSING=15  TRANSFORMED=0
关键字段映射正确率 = 100%（DIFFERENT=0）
```

| 字段 | MATCH | MISSING | 说明 |
|---|---|---|---|
| 月搜索量 search_volume | 39 | 4 | 4 个流量词源文件本身无月搜索量（空值如实标记） |
| 商品数 product_count | 43 | 0 | 全量一致 |
| ABA周排名 aba_weekly_rank | 40 | 3 | 源文件空值如实标记 |
| 点击量 clicks | 39 | 4 | 源文件空值如实标记 |
| 展示量 impressions | 39 | 4 | 源文件空值如实标记 |

- MISSING 全部来自源文件空值（NA/-/空），非映射丢失；
- DIFFERENT=0 证明归一化无损：raw 值 → 标准库值完全一致（含 MX 货币/百分号清洗后的数值等价）；
- 对账幂等：重跑先清该批次该字段旧结果，结果可复算。

## 6. 校准（§23）

- `computeCalibration`（Bias/MAPE/Median Error）与 `applyCalibration`（CALIBRATED_ESTIMATE，绝不冒充真实）已实现并测试；
- 校准 API 强制要求显式传 provider/metric/pairs（≥1），防止无真实双源时编造校准；
- **当前未运行真实校准**：需要"同一指标的两个来源"（如 SellerSprite 估算 vs Amazon 实际销量），Amazon 实际数据未接入（见 AMAZON_INTEGRATION_STATUS.md）。

## 7. 真实数据覆盖度（§42）

| 数据域 | 状态 | 说明 |
|---|---|---|
| Market | ESTIMATED | SellerSprite 导入批次（4 文件 113 行真实关键词） |
| Owned Sales | MISSING | 未导入 Amazon 报表 / 未授权 SP-API |
| Competitor Sales | ESTIMATED | 269 条 SellerSprite 关键词快照（含 ABA 排名/点击/展示/购买） |
| Ads | MISSING | Ads 未授权/未导入 |
| Supply Chain | PARTIAL | 4 个自有 SKU 已建（成本未录入） |

## 8. 模式行为验收

- REAL 模式创建 owned_product 任务（SKU-A 灰色枕诊断）→ 运行 → **needs_data**；
- 错误信息："当前缺少 SellerSprite / Amazon 数据，无法形成真实业务结论"；
- missing_data_items 落库：`capability:owned_orders`（Amazon 自有销量缺失）；
- 全程无 Mock 兜底。

## 9. 未完成项与所需输入（诚实声明）

| 项 | 阻塞原因 | 需要用户提供 |
|---|---|---|
| 真实 4 SKU（记忆棉枕）录入 | 无真实 ASIN/店铺数据 | 4 个自有 SKU 的 ASIN、店铺名、成本、库存 |
| "灰色枕跑输"真实诊断 | 无 Amazon 实际销量 | Amazon 业务报表 / SP-API 凭据 |
| SellerSprite API/MCP 通道 | 未配置 | SELLERSPRITE_API_KEY 或 MCP 连接 |
| Amazon SP-API / Ads | 未配置 | Client ID / Secret / Refresh Token / Profile ID |
| 真实校准 | 无双源数据 | 同一指标的两个来源（估算 + 实际） |
| LLM 分析 | 未配置 | AI_API_KEY（可选，缺省走确定性规则引擎） |

## 10. 验收命令（可复算）

```powershell
# 导入真实文件（P0-1）
POST /api/import/sellersprite/reverse-asin  body={"file_path","marketplace","asin","mode":"REAL"}

# 对账（§22）
POST /api/reconciliation/run  body={"ingestion_id":<最新批次id>}

# Provider / 覆盖度
GET /api/providers/status
GET /api/dashboard/coverage

# REAL 禁 Mock
POST /api/system/mode {"mode":"REAL"} → 创建并运行 owned_product 任务 → 期望 needs_data
```
