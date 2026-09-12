# V2.2 HTTP Black Box Test Report（§49-§54）

- 测试文件：`tests/v22/blackbox.test.ts`
- 约束：**只允许** 启动服务 → 调用 HTTP API → 读取 HTTP 结果；**零内部 import**（无 rule engine / database engine / internal helper，仅 node 标准库）
- 运行方式：`node --import tsx --test tests/v22/blackbox.test.ts`（每次启动独立临时服务实例 + 独立临时 DB）
- 运行时间：2026-09-12；结果：**5/5 全过**

## Case A —— REAL + Sentinel Real Provider → Evidence 出现 987654（§50/§31）

```
启动（SENTINEL_PROVIDER=market）→ POST /api/system/mode REAL
→ POST /api/providers/health/refresh（sentinel_market=CONNECTED）
→ POST /api/research-jobs（existing_market, target=Sentinel Pillow）
→ POST /api/research-jobs/:id/run
→ GET /api/research-jobs/:id/evidence
```

- run 返回 **200**（非 needs_data），Evidence 数组非空
- **Evidence Trace 序列化包含 `987654`**（market_monthly_sales Evidence + 快照值）
- 市场快照 `GET /api/markets/:id/snapshots`：存在 `monthly_sales = 987654`
- 验证点：REAL 模式下 Snapshot / Metric / Evidence 均来自真实 Provider（sentinel_market），**未出现旧 Mock 值**

## Case B —— REAL 无 Provider → needs_data，无任何 Mock 记录（§51）

```
启动（无 SENTINEL、无真实凭据）→ REAL
→ POST /api/research-jobs（existing_market）→ POST /api/research-jobs/:id/run
```

- run 返回 `status: "needs_data"`（不自动切 Mock）
- `GET /api/research-jobs/:id/evidence` = **空数组**（不允许任何 Mock 记录）
- `GET /api/research-jobs/:id/missing-data` 记录缺失能力（capability:*）

## Case C —— 非法 approve（非 waiting_approval）→ 403/409（§52）

```
POST /api/research-jobs（new_opportunity，未 run，仍为 draft）
→ 直接 POST /api/research-jobs/:id/approve
```

- 返回 **403**，`code: "APPROVAL_BYPASS_BLOCKED"`（审批绕过拦截，V2.1 §29 语义保持）

## Case D —— 错误 SellerSprite（未知字段）→ mapping_queue（§53）

```
写临时 CSV：ASIN,品牌,月销量,unknown_column_xyz
→ POST /api/import/sellersprite/reverse-asin
→ GET /api/mapping-queue
```

- 导入成功；`GET /api/mapping-queue` 出现 `source_column: "unknown_column_xyz", status: "pending"`（未知列不静默丢弃）

## Case E —— Amazon Report 缺失字段 → null / missing，禁止补 0（§54/§25）

```
写临时 CSV：asin,date,unitsOrdered,orderedProductSales / B0TESTE001,2026-08-01,,99.5
→ POST /api/import/amazon/report（report_type=business）
→ GET /api/imports/:id + GET /api/missing-data
```

- raw_payload 中 `unitsOrdered` **原样保留为空**（`"unitsOrdered":""`，未被补成 0）
- `GET /api/missing-data` 出现 `entity_type: "raw_ingestion", field: "units"`（缺失如实记录）

## 结论

HTTP Black Box 5 个 Case 全部通过，覆盖：Sentinel 真执行（987654 穿透）、无 Provider 不落 Mock、审批绕过拦截、未知列进队列、缺失字段保 null。生产环境禁止 import 内部模块的约束被完全遵守。
