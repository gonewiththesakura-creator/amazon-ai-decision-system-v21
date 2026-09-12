/**
 * Workflow: new_opportunity —— 全新赛道 / 新品机会实验室（V2 §58, 任务 C；V2.2 §7 同构）
 * AI 拆市场 → 生成研究树 → 采集（按能力取 Provider，禁止 Mock）→ 数据需求清单 → 机会池
 * 第一版不要求一次抓完整全 Amazon 数据；数据不足如实输出 needs_data
 */
import { getDatabase } from '../db/connection.js';
import { getResearchJob, transitionJob } from '../modules/research/job.js';
import { normalizeMarketData, normalizeProductData } from '../normalization/engine.js';
import { upsertMarketNode } from '../modules/snapshots/engine.js';
import { evaluateHardGates } from '../modules/rules/engine.js';
import { getActiveRuleProfile } from '../modules/rules/profile.js';
import { generateInsight } from '../ai/service.js';
import { addWatchlist, recordDataTask, runStep } from './helpers.js';
import type { HardGateContext } from '../modules/rules/engine.js';
import type { MarketResearchProvider } from '../adapters/providers/types.js';
import { getCapabilityProvider, type WorkflowDataContext } from './context.js';

/** 由自然语言想法确定性拆解市场树（V2 §8.2-8.3） */
export function buildResearchTree(idea: string): Array<{ name: string; parent: string | null; level: number }> {
  const root = idea.trim() || 'New Product Idea';
  const branches = ['Combo Pack', 'Starter Kit', 'Accessories', 'Budget Option', 'Premium Option'];
  const nodes: Array<{ name: string; parent: string | null; level: number }> = [{ name: root, parent: null, level: 1 }];
  for (const b of branches) {
    nodes.push({ name: `${root} ${b}`, parent: root, level: 2 });
  }
  return nodes;
}

/** V2.2：New Opportunity Workflow —— 数据来自 ctx.providers（禁止 getAdapter('mock')） */
export async function runNewOpportunityWorkflow(jobId: number, ctx: WorkflowDataContext): Promise<void> {
  const db = getDatabase();
  const job = getResearchJob(jobId)!;
  const profile = getActiveRuleProfile('amazon_us_new_product_default_v1') ?? getActiveRuleProfile();
  if (!profile) throw new Error('缺少可用 RuleProfile');

  const marketCtx = ctx.providers['market_size'];
  const topCtx = ctx.providers['top_products'] ?? null;
  const marketProvider = getCapabilityProvider<MarketResearchProvider>(ctx, 'market_size');
  const topProductsProvider = topCtx ? (topCtx.impl as MarketResearchProvider) : null;
  const idea = job.target || job.description || 'New Product Idea';

  try {
    transitionJob(jobId, 'planned');

    // plan：拆市场 + 研究树
    const tree = await runStep(jobId, 'plan', () => {
      const nodes = buildResearchTree(idea);
      const ids = new Map<string, number>();
      for (const n of nodes) {
        const id = upsertMarketNode({
          name: n.name,
          parent_id: n.parent ? (ids.get(n.parent) ?? null) : null,
          level: n.level,
          marketplace: job.marketplace,
          source: 'ai-tree',
        });
        ids.set(n.name, id);
      }
      return { tree: nodes, root_id: ids.get(idea)! };
    });

    transitionJob(jobId, 'collecting');

    // collect_market：根节点概览（market_size 能力，REAL 不 Mock）
    const overview = await runStep(jobId, 'collect_market', async () => {
      const o = await marketProvider.getMarketOverview({ market_name: idea, marketplace: job.marketplace });
      recordDataTask({
        jobId,
        sourceName: marketCtx.name,
        taskType: 'collect_market',
        target: idea,
        status: 'success',
        result: { total: 1, success: 1, failed: 0 },
      });
      return o;
    });

    // collect_products：top_products 为 optional 能力，未解析时如实降级
    const products = await runStep(jobId, 'collect_products', async () => {
      if (!topProductsProvider) {
        db.prepare(
          `INSERT INTO missing_data_items (research_job_id, entity_type, entity_id, field, missing_reason, required_for_decision, manual_validation_required, status, created_at)
           VALUES (?, 'opportunity', ?, 'top_products', '当前无 TOP 产品 Provider（optional 能力未解析）', 0, 1, 'open', ?)`
        ).run(jobId, jobId, new Date().toISOString());
        return [];
      }
      const top = await topProductsProvider.getTopProducts({ market_name: idea, marketplace: job.marketplace, limit: 30 });
      recordDataTask({
        jobId,
        sourceName: topCtx.name,
        taskType: 'collect_products',
        target: `${idea} TOP30`,
        status: 'partial',
        result: { total: top.length, success: top.length, failed: 0 },
      });
      return top;
    });

    transitionJob(jobId, 'normalizing');

    const normalized = await runStep(jobId, 'normalize', () => {
      const marketId = normalizeMarketData(overview, { is_demo: marketCtx.isMock, job_id: jobId, entityType: 'market' }).marketId;
      const productIds = products.map((p) => normalizeProductData(p, { is_demo: topCtx?.isMock ?? false, job_id: jobId, entityType: 'product' }).productId);
      return { marketId, productIds };
    });

    // validate：列数据需求清单
    transitionJob(jobId, 'validating');
    const dataNeeds = await runStep(jobId, 'validate', () => {
      const needs = [
        { field: '关键词搜索量与趋势', reason: '需 ABA / 关键词工具数据' },
        { field: '竞品价格带分布', reason: '需完整 TOP100 价格数据' },
        { field: '目标人群需求验证', reason: '需评论或调研数据' },
        { field: '供应链报价与 MOQ', reason: '需供应商询价' },
        { field: 'IP / 专利检索', reason: '需专业检索' },
      ];
      for (const n of needs) {
        db.prepare(
          `INSERT INTO missing_data_items (research_job_id, entity_type, entity_id, field, missing_reason, required_for_decision, manual_validation_required, status, created_at)
           VALUES (?, 'opportunity', ?, ?, ?, 1, 1, 'open', ?)`
        ).run(jobId, normalized.marketId, n.field, n.reason, new Date().toISOString());
      }
      return { data_needs: needs };
    });

    transitionJob(jobId, 'calculating');

    // hard_gate：新赛道关键数据普遍缺失 → needs_data（如实）
    const hardGate = await runStep(jobId, 'hard_gate', () => {
      const context: HardGateContext = {
        ip_risk: null,
        certification_required: false,
        certification_available: null,
        contribution_profit_rate: null,
        moq_cost: null,
        total_budget: null,
        within_logistics: null,
        supply_chain_validated: null,
        critical_data_missing: true,
      };
      const result = evaluateHardGates(context, profile);
      db.prepare(
        `INSERT INTO rule_executions (research_job_id, rule_profile_id, rule_type, input_json, output_json, created_at)
         VALUES (?, ?, 'hard_gate', ?, ?, ?)`
      ).run(jobId, profile.id, JSON.stringify(context), JSON.stringify(result), new Date().toISOString());
      return result;
    });

    transitionJob(jobId, 'analyzing');

    // reverse_review：列出未知项
    await runStep(jobId, 'reverse_review', async () => {
      const { insightId } = await generateInsight({
        agent: 'reverse_review',
        entityType: 'opportunity',
        entityId: normalized.marketId,
        jobId,
        promptVersion: 'reverse-review.v1',
        data: {
          product_name: idea,
          market: {
            growth30d: null,
            growth90d: null,
            top10_sales_share: overview.top10_sales_share,
            new_product_share: overview.new_product_count != null && overview.product_count ? overview.new_product_count / overview.product_count : null,
            avg_price: overview.avg_price,
            median_reviews: overview.median_reviews,
          },
          product: {
            price_gap_to_median: null,
            contribution_profit_rate: null,
            moq_cost: null,
            total_budget: null,
            ip_risk: null,
            seasonality: null,
            compliance_complexity: null,
            supply_chain_fit: null,
          },
          score_total: null,
          hard_gate_result: hardGate.result,
          has_ad_data: false,
          missing: dataNeeds.data_needs.map((n) => n.field),
        },
      });
      return { insight_id: insightId };
    });

    // 机会池
    await runStep(jobId, 'approval', () => {
      db.prepare(
        `INSERT INTO opportunities (name, source_type, market_id, opportunity_score, hard_gate_status, status, summary, created_at)
         VALUES (?, 'new_opportunity', ?, NULL, ?, 'pending_review', ?, ?)`
      ).run(idea, normalized.marketId, hardGate.result, `新赛道研究树已生成（${tree.tree.length} 节点），关键数据待补充`, new Date().toISOString());
      addWatchlist({ item_type: 'market', item_id: normalized.marketId, watch_frequency: 'weekly' });
      return { opportunity: idea };
    });

    // 数据不足：如实进入 needs_data
    transitionJob(jobId, 'needs_data', hardGate.result === 'reject' ? 'Hard Gate 拒绝' : '关键数据缺失，等待补充数据后重新评估');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      transitionJob(jobId, 'failed', msg);
    } catch {
      /* ignore */
    }
    throw e;
  }
}


