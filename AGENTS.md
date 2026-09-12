# AGENTS.md — 团队执行规则

> 本文件是 AI 代理在本仓库工作时的强制规则（依据 V2 指令 §53）。

## 项目目标

第一阶段：把公司现在运营的 **4 个记忆棉枕头 SKU 真正看明白**。
- 模块一：现有记忆棉枕头市场诊断
- 模块二：4 SKU 竞争表现诊断
- 模块三：记忆棉相关待开发产品
- 模块四：全新赛道 / 新品机会
（模块三、四在 P0 后逐步接通，本版实现核心闭环。）

## 数据目录约定

```
data/raw/          原始导入文件（CSV）
data/normalized/   标准化中间产物（预留）
data/imports/      用户导入模板与样例
data/reports/      报告导出（预留）
data/amazon-ai.db  SQLite 数据库（运行时生成，勿提交）
```

## 禁止（硬性红线）

1. **禁止覆盖历史 Snapshot** —— 快照只 INSERT，永不 UPDATE/DELETE。
2. **禁止把 mock 当真实** —— 所有演示数据 `is_demo=true`，UI 永久显示演示数据横幅；API 响应头 `X-Demo-Data: true`。
3. **禁止缺失数据填 0** —— 必须 `null` + `missing_reason`；不满足决策要求时输出 `needs_data`。
4. **禁止 AI 无证据输出强结论** —— 每条 AI 结论必须关联 Evidence；置信度由数据完整度决定。
5. **禁止自动下单 / 自动判定专利安全** —— 重大业务动作必须走 Approval Gate + 人工决策。
6. **禁止把业务规则写死在页面/组件** —— 阈值与评分全部走 `rule_profiles`。
7. **禁止把数据源调用写死在业务层** —— 一律走 Adapter。

## 确定性计算优先

增长率、均值、中位数、百分位、集中度、硬门槛、机会评分、相对市场表现、状态流转 **必须由代码计算**，不得交给 LLM"重算一遍"。AI 只负责解释、归因假设、评论归类、反方审查、决策建议。

## 数据不足时的行为

- 关键字段缺失 → Job 状态置 `needs_data`，写 `missing_data_items`。
- AI 结论必须包含 `missing_data` 字段；数据不足以判断时输出"当前无法判断"。

## 完成检查（每次交付前必须执行）

```bash
npm run lint        # tsc --noEmit --strict
npm run typecheck   # tsc --noEmit
npm run test        # node:test 单元 + 集成
npm run build       # typecheck + 构建标记
```

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（tsx watch，默认端口 3000）
npm run seed         # 重新生成演示数据种子
npm start            # 启动服务
```
