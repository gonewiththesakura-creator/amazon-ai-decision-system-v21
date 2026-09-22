/**
 * Workflow: adjacent_product —— 记忆棉相关待开发产品（V2 §23-34, 任务 B；V2.2 §7 同构）
 * Research Task Book → 采集（按能力取 Provider，禁止 Mock）→ 标准化 → Hard Gate → 评分 → 评论缺口 → 反向审查 → 等待人工审批
 */
import { getDatabase } from '../db/connection.js';
import { getResearchJob, transitionJob } from '../modules/research/job.js';
import { normalizeMarketData, normalizeProductData, normalizeReviewData } from '../normalization/engine.js';
import { growthFromSnapshots, listMarketSnapshots } from '../modules/snapshots/engine.js';
import { evaluateHardGates, computeOpportunityScore, scoreGrade, type ScoreInput } from '../modules/rules/engine.js';
import { getActiveRuleProfile, parseThresholds } from '../modules/rules/profile.js';
import { generateInsight } from '../ai/service.js';
import { addWatchlist, recordDataTask, runStep } from './helpers.js';
import type { HardGateContext } from '../modules/rules/engine.js';
import type { RawMarketData, RawProductData, RawReviewData } from '../adapters/types.js';
import type { MarketResearchProvider } from '../adapters/providers/types.js';
import { getCapabilityProvider, type WorkflowDataContext } from './context.js';

export interface ResearchTaskBook {
  product_idea: string;
  marketplace?: string;
  category_scope?: string;
  price_range?: [number, number];
  total_budget?: number;
  per_product_budget?: number;
  min_profit_rate?: number;
  max_weight_kg?: number;
  supply_chain_capability?: string;
  ip_risk?: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
  certification_required?: boolean;
  certification_available?: boolean | null;
  contribution_profit_rate?: number | null;
  moq_cost?: number | null;
  within_logistics?: boolean | null;
  supply_chain_validated?: boolean | null;
  seasonality?: 'low' | 'medium' | 'high' | null;
  compliance_complexity?: 'low' | 'medium' | 'high' | null;
  price_gap_to_median?: number | null;
}

export const DEFAULT_TASK_BOOK: ResearchTaskBook = {
  product_idea: 'Memory Foam U-Shaped Pillow',
  marketplace: 'US',
  price_range: [24, 32],
  total_budget: 50000,
  per_product_budget: 6,
  min_profit_rate: 18,
  max_weight_kg: 1.5,
  supply_chain_capability: 'memory_foam',
  ip_risk: 'medium',
  certification_required: false,
  certification_available: true,
  contribution_profit_rate: 22,
  moq_cost: 8000,
  within_logistics: true,
  supply_chain_validated: true,
  seasonality: 'low',
  compliance_complexity: 'medium',
  price_gap_to_median: -5,
};

export function parseTaskBook(description: string | null): ResearchTaskBook {
  if (!description) return { ...DEFAULT_TASK_BOOK };
  try {
    return { ...DEFAULT_TASK_BOOK, ...(JSON.parse(description) as Partial<ResearchTaskBook>) };
  } catch {
    // 描述不是 JSON：视为产品想法
    return { ...DEFAULT_TASK_BOOK, product_idea: description };
  }
}

/** V2.2：Adjacent Product Workflow —— 数据全部来自 ctx.providers（禁止 getAdapter('mock')） */
export async function runAdjacentProductWorkflow(jobId: number, ctx: WorkflowDataContext): Promise<void> {
  const db = getDatabase();
  const job = getResearchJob(jobId)!;
  const profile = getActiveRuleProfile('amazon_us_new_product_default_v1') ?? getActiveRuleProfile();
  if (!profile) throw new Error('缺少可用 RuleProfile');

  const marketCtx = ctx.providers['market_size'];
  const topCtx = ctx.providers['top_products'];
  const reviewCtx = ctx.providers['review_text'] ?? null;
  const marketProvider = getCapabilityProvider<MarketResearchProvider>(ctx, 'market_size');
  const topProductsProvider = getCapabilityProvider<MarketResearchProvider>(ctx, 'top_products');
  const reviewProvider = reviewCtx && typeof (reviewCtx.impl as MarketResearchProvider).getReviews === 'function' ? (reviewCtx.impl as MarketResearchProvider) : null;
  const isDemo = marketCtx.isMock;

  try {
    transitionJob(jobId, 'planned');
    const taskBook = parseTaskBook(job.description);
    const marketName = job.target || taskBook.product_idea;

    // plan：研究任务书
    await runStep(jobId, 'plan', () => {
      return { task_book: taskBook, market_name: marketName };
    });

    transitionJob(jobId, 'collecting');

    // collect_market / collect_products / collect_reviews（按能力取 Provider）
    const collected = await runStep(jobId, 'collect_market', async () => {
      const overview = await marketProvider.getMarketOverview({ market_name: marketName, marketplace: job.marketplace });
      recordDataTask({
        jobId,
        sourceName: marketCtx.name,
        taskType: 'collect_market',
        target: marketName,
        status: 'success',
        result: { total: 1, success: 1, failed: 0 },
      });
      return overview;
    });

    const products = await runStep(jobId, 'collect_products', async () => {
      const top = await topProductsProvider.getTopProducts({ market_name: marketName, marketplace: job.marketplace, limit: 60 });
      recordDataTask({
        jobId,
        sourceName: topCtx.name,
        taskType: 'collect_products',
        target: `${marketName} TOP60`,
        status: 'success',
        result: { total: top.length, success: top.length, failed: 0 },
      });
      return top;
    });

    const reviews: RawReviewData[] = await runStep(jobId, 'collect_reviews', async () => {
      // review_text 为 optional 能力：未解析时如实降级（REAL 不 Mock）
      if (!reviewProvider) {
        db.prepare(
          `INSERT INTO missing_data_items (research_job_id, entity_type, entity_id, field, missing_reason, required_for_decision, manual_validation_required, status, created_at)
           VALUES (?, 'development_project', ?, 'review_text', '当前无评论 Provider（optional 能力未解析）', 0, 1, 'open', ?)`
        ).run(jobId, jobId, new Date().toISOString());
        return [];
      }
      const topAsins = products.slice(0, 10).map((p) => p.asin);
      const all: RawReviewData[] = [];
      for (const asin of topAsins) {
        const rs = await reviewProvider.getReviews({ asin, limit: 40 });
        all.push(...rs);
      }
      recordDataTask({
        jobId,
        sourceName: reviewCtx.name,
        taskType: 'collect_reviews',
        target: `${marketName} TOP10 评论`,
        status: 'success',
        result: { total: all.length, success: all.length, failed: 0 },
      });
      return all;
    });

    transitionJob(jobId, 'normalizing');

    // normalize（is_demo 由 Provider 决定，V2.2 §12）
    const normalized = await runStep(jobId, 'normalize', () => {
      const marketId = normalizeMarketData(collected, { is_demo: isDemo, job_id: jobId, entityType: 'market' }).marketId;
      const productIds = products.map((p) => normalizeProductData(p, { is_demo: topCtx.isMock, job_id: jobId, entityType: 'product' }).productId);
      const reviewIds = reviews.map((r) => normalizeReviewData(r, { is_demo: reviewCtx?.isMock ?? false }));
      return { marketId, productIds, reviewIds };
    });

    // validate
    transitionJob(jobId, 'validating');
    await runStep(jobId, 'validate', () => {
      const critical = db
        .prepare('SELECT COUNT(*) AS c FROM missing_data_items WHERE research_job_id = ? AND required_for_decision = 1')
        .get(jobId) as { c: number };
      return { critical_missing: critical.c, valid: critical.c === 0 };
    });

    // 待人工验证项（V2 任务 B 输出：供应商报价 / MOQ / 专利）
    const missingItems: Array<{ field: string; reason: string }> = [
      { field: '供应商精确报价', reason: '需人工询价确认' },
      { field: 'MOQ 最终确认', reason: '需与供应商确认' },
      { field: '专利检索结果', reason: '需完成 IP 初查' },
    ];
    for (const m of missingItems) {
      db.prepare(
        `INSERT INTO missing_data_items (research_job_id, entity_type, entity_id, field, missing_reason, required_for_decision, manual_validation_required, status, created_at)
         VALUES (?, 'development_project', ?, ?, ?, 0, 1, 'open', ?)`
      ).run(jobId, jobId, m.field, m.reason, new Date().toISOString());
    }
    transitionJob(jobId, 'calculating');

    // hard_gate
    const hardGate = await runStep(jobId, 'hard_gate', () => {
      const context: HardGateContext = {
        ip_risk: taskBook.ip_risk ?? null,
        certification_required: taskBook.certification_required ?? false,
        certification_available: taskBook.certification_available ?? null,
        contribution_profit_rate: taskBook.contribution_profit_rate ?? null,
        moq_cost: taskBook.moq_cost ?? null,
        total_budget: taskBook.total_budget ?? null,
        within_logistics: taskBook.within_logistics ?? null,
        supply_chain_validated: taskBook.supply_chain_validated ?? null,
        critical_data_missing: false,
      };
      const evalResult = evaluateHardGates(context, profile);
      db.prepare(
        `INSERT INTO rule_executions (research_job_id, rule_profile_id, rule_type, input_json, output_json, created_at)
         VALUES (?, ?, 'hard_gate', ?, ?, ?)`
      ).run(jobId, profile.id, JSON.stringify(context), JSON.stringify(evalResult), new Date().toISOString());
      return evalResult;
    });

    if (hardGate.result === 'reject') {
      transitionJob(jobId, 'rejected', 'Hard Gate 未通过');
      db.prepare(
        `INSERT INTO decisions (research_job_id, entity_type, entity_id, decision, reason, decided_by, decided_at)
         VALUES (?, 'development_project', ?, 'rejected', ?, 'rule_engine', ?)`
      ).run(jobId, jobId, `Hard Gate 拒绝: ${hardGate.gates.filter((g) => g.status === 'fail').map((g) => g.reason).join('; ')}`, new Date().toISOString());
      return;
    }
    if (hardGate.result === 'needs_data') {
      transitionJob(jobId, 'needs_data', 'Hard Gate 关键数据缺失');
      // 仍进入机会池等待补数据
      db.prepare(
        `INSERT INTO opportunities (name, source_type, market_id, opportunity_score, hard_gate_status, status, summary, created_at)
         VALUES (?, 'adjacent_product', ?, NULL, 'needs_data', 'pending_review', ?, ?)`
      ).run(marketName, normalized.marketId, `Hard Gate 需要补数据：${hardGate.gates.filter((g) => g.status === 'needs_data').map((g) => g.name).join('、')}`, new Date().toISOString());
      return;
    }

    // score
    const scoreResult = await runStep(jobId, 'score', () => {
      const snaps = listMarketSnapshots(normalized.marketId);
      const g30 = growthFromSnapshots(snaps, 30);
      const g90 = growthFromSnapshots(snaps, 90);
      const latest = snaps[snaps.length - 1];
      const input: ScoreInput = {
        market: {
          monthly_revenue: latest?.monthly_revenue ?? null,
          monthly_sales: latest?.monthly_sales ?? null,
          growth30d: g30,
          growth90d: g90,
          top10_sales_share: latest?.top10_sales_share ?? null,
          median_reviews: latest?.median_reviews ?? null,
          new_product_share: latest?.new_product_count != null && latest.product_count ? latest.new_product_count / latest.product_count : null,
          avg_price: latest?.avg_price ?? null,
          median_price: latest?.median_price ?? null,
        },
        product: {
          contribution_profit_rate: taskBook.contribution_profit_rate ?? null,
          moq_cost: taskBook.moq_cost ?? null,
          total_budget: taskBook.total_budget ?? null,
          supply_chain_fit: 0.75,
          within_logistics: taskBook.within_logistics ?? null,
          ip_risk: taskBook.ip_risk ?? null,
          seasonality: taskBook.seasonality ?? null,
          compliance_complexity: taskBook.compliance_complexity ?? null,
          price_gap_to_median: taskBook.price_gap_to_median ?? null,
        },
      };
      const breakdown = computeOpportunityScore(input, profile);
      db.prepare(
        `INSERT INTO score_results (research_job_id, entity_type, entity_id, total_score, breakdown_json, data_completeness, created_at)
         VALUES (?, 'development_project', ?, ?, ?, ?, ?)`
      ).run(jobId, jobId, breakdown.total, JSON.stringify(breakdown), 0.85, new Date().toISOString());
      db.prepare(
        `INSERT INTO rule_executions (research_job_id, rule_profile_id, rule_type, input_json, output_json, created_at)
         VALUES (?, ?, 'score', ?, ?, ?)`
      ).run(jobId, profile.id, JSON.stringify(input), JSON.stringify({ total: breakdown.total, grade: scoreGrade(breakdown.total, profile) }), new Date().toISOString());
      return { total: breakdown.total, breakdown, grade: scoreGrade(breakdown.total, profile) };
    });

    transitionJob(jobId, 'analyzing');

    // review_gap
    const reviewGap = await runStep(jobId, 'review_gap', async () => {
      const { insightId } = await generateInsight({
        agent: 'review_gap',
        entityType: 'development_project',
        entityId: jobId,
        jobId,
        promptVersion: 'review-gap.v1',
        data: {
          reviews: reviews.map((r) => ({ product_asin: r.asin, text: r.text, rating: r.rating })),
          competitor_asins: products.slice(0, 10).map((p) => p.asin),
          source: reviewCtx ? reviewCtx.name : undefined,
        },
      });
      return { insight_id: insightId };
    });

    // reverse_review
    const reverseReview = await runStep(jobId, 'reverse_review', async () => {
      const snaps = listMarketSnapshots(normalized.marketId);
      const latest = snaps[snaps.length - 1];
      const { insightId } = await generateInsight({
        agent: 'reverse_review',
        entityType: 'development_project',
        entityId: jobId,
        jobId,
        promptVersion: 'reverse-review.v1',
        data: {
          product_name: marketName,
          market: {
            growth30d: growthFromSnapshots(snaps, 30),
            growth90d: growthFromSnapshots(snaps, 90),
            top10_sales_share: latest?.top10_sales_share ?? null,
            new_product_share: latest?.new_product_count != null && latest.product_count ? latest.new_product_count / latest.product_count : null,
            avg_price: latest?.avg_price ?? null,
            median_reviews: latest?.median_reviews ?? null,
          },
          product: {
            price_gap_to_median: taskBook.price_gap_to_median ?? null,
            contribution_profit_rate: taskBook.contribution_profit_rate ?? null,
            moq_cost: taskBook.moq_cost ?? null,
            total_budget: taskBook.total_budget ?? null,
            ip_risk: taskBook.ip_risk ?? null,
            seasonality: taskBook.seasonality ?? null,
            compliance_complexity: taskBook.compliance_complexity ?? null,
            supply_chain_fit: 0.75,
          },
          score_total: scoreResult.total,
          hard_gate_result: hardGate.result,
          has_ad_data: false,
          missing: missingItems.map((m) => m.field),
        },
      });
      return { insight_id: insightId };
    });

    transitionJob(jobId, 'reverse_review');

    // waiting_approval + 机会池
    await runStep(jobId, 'approval', () => {
      db.prepare(
        `INSERT INTO opportunities (name, source_type, market_id, opportunity_score, hard_gate_status, status, summary, latest_insight_id, latest_reverse_review_id, created_at)
         VALUES (?, 'adjacent_product', ?, ?, ?, 'pending_review', ?, ?, ?, ?)`
      ).run(
        marketName,
        normalized.marketId,
        scoreResult.total,
        hardGate.result,
        `${marketName} 机会评分 ${scoreResult.total}，等待人工审批`,
        reviewGap.insight_id,
        reverseReview.insight_id,
        new Date().toISOString()
      );
      addWatchlist({ item_type: 'development_project', item_id: jobId, watch_frequency: 'weekly' });
      return { opportunity: marketName };
    });

    transitionJob(jobId, 'waiting_approval');
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


