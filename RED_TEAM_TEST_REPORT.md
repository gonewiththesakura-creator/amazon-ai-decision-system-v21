# Red Team 对抗测试报告（RED_TEAM_TEST_REPORT）

> 依据 V2.1 §53（六项 P0 对抗测试）、§28（Hard Gate 红队案例）、§39（恶意数据）、§12-4（映射正确率）
> 报告日期：2026-09-11 · 执行：`npm run test`（全量 31/31 通过，其中 Red Team 9/9）

## 1. 执行环境

- 引擎：node --import tsx --test
- 全量测试：**31/31 通过**（22 项 V2 既有测试 + 9 项 V2.1 Red Team）
- 类型检查：`tsc --noEmit` 干净
- 测试均为黑盒验收（测试不读取实现细节，从公开 API / 业务函数断言行为）

## 2. 测试结果逐项

### §53-1 REAL 模式禁止 Mock fallback → needs_data ✅
- 场景：REAL 模式下创建 owned_product 任务（缺 owned_orders 能力），运行任务；
- 断言：任务进入 **needs_data**（而非自动切 Mock 继续跑）；
- 附加断言：missing_data_items 落库（capability 级），错误信息明确"无法形成真实业务结论"。

### §53-2 Raw trace —— Evidence 可穿透到 raw_record ✅
- 场景：真实导入 → 生成快照 → 构造 Evidence → buildEvidenceTrace 全链穿透；
- 断言：assertEvidenceTraceIntegrity 通过（Insight→Metric→Snapshot→Normalized→RawRecord→RawIngestion→Source→Decision 时间/实体一致性校验）；
- 对比：旧 Mock Evidence（无 raw 关联）如实报"无法穿透"（V2.1 修正点）。

### §53-3 Import mapping —— 未知列进入 mapping_queue ✅
- 场景：导入含未知列（如"父体销量"）的表格；
- 断言：未知列进入 mapping_queue（不静默丢弃、不崩溃）；已知 32 列全部映射成功。

### §53-4 Duplicate ASIN / 重复导入 ✅
- 场景：同一关键词重复导入；
- 断言：keyword 不重复创建；同日快照覆盖更新（findSnap→UPDATE）；真实 4 文件重导 dup=24/28/18/43 全部命中已有记录。

### §53-5 Source conflict —— Amazon 实际 vs SellerSprite 估算并存 ✅
- 场景：同一实体/指标两个来源（Actual vs Estimated）；
- 断言：source_conflicts 并存显示，variance 计算正确（+37.5% 案例实测），不二选一静默覆盖。

### §53-6 Approval bypass —— 非法状态直接批准被后端拒绝 ✅
- 场景：任务处于 analyzing（非 waiting_approval）时调用 approve；
- 断言：后端返回 **403 APPROVAL_BYPASS_BLOCKED**（前端按钮隐藏只是 UI 层，后端硬门禁）；reject 非法状态同样 403。

### §28 Hard Gate 红队 3 案例 ✅
| 案例 | 输入 | 结果 |
|---|---|---|
| IP 侵权（critical） | 标题/描述命中侵权词 | **REJECT** |
| 缺强制数据 | 缺强制字段 | **NEEDS_DATA** |
| MOQ 超预算 | 起订量 > 预算 | **REJECT** |

### §39 恶意数据不崩溃 ✅
- 输入：NA / 0 / $39.99 / 39,99 / 负值 / 超大值 / GBK 编码 / BOM 文件头；
- 断言：解析不崩溃、空值归一化为 null、数值化正确（$39.99→39.99、39,99→39.99、12%→12）。

### §12-4 关键字段映射正确率 ✅
- 场景：真实 ReverseASIN 导入 → 对账；
- 断言：关键字段（月搜索量/商品数）映射正确率 **100%**（对账 DIFFERENT=0）；真实批次全字段 MATCH=200 / DIFFERENT=0 / MISSING=15（源文件空值）。

## 3. 全量测试统计

```
# tests 31
# pass 31
# fail 0
# duration ~0.8s
tsc --noEmit: 0 error
```

## 4. 遗留风险（诚实声明）

- Amazon SP-API / Ads 未配置凭据，Red Team 未能对真实 Amazon 响应做对抗（仅边界 Unauthorized 验证）；
- 真实 4 SKU 的 ASIN/店铺数据未提供，§28 的 owned_product 场景基于测试数据；
- LLM 分析未配置（缺 AI_API_KEY），§53 系列验证的是确定性引擎路径。

## 5. 复算命令

```powershell
npm run test                          # 全量 31/31
node --import tsx --test "tests/v21/redteam.test.ts"   # 仅 Red Team 9 项
npx tsc --noEmit                      # 类型检查
```
