/**
 * Workflow: existing_market —— 现有记忆棉枕头市场诊断（V2 §14）
 * 数据采集 → 标准化 → 快照 → 计算 → AI 解释 → 证据 → 监控
 */
import { getDatabase } from '../db/connection.js';
import { getResearchJob, transitionJob } from '../modules/research/job.js';
import { getAdapter } from '../adapters/index.js';
import { normalizeMarketData, normalizeProductData, hasRequiredData } from '../normalization/engine.js';
import {
  findMarketNode,
  growthFromSnapshots,
  listMarketSnapshots,
  upsertMarketNode,
} from '../modules/snapshots/engine.js';
import { generateInsight } from '../ai/service.js';
import type { RawMarketData, RawProductData } from '../adapters/types.js';
import { addWatchlist, recordDataTask, runStep } from './helpers.js';
import { getActiveRuleProfile } from '../modules/rules/profile.js';

export const MEMORY_FOAM_TREE: Array<{ name: string; parent: string | null; level: number }> = [
  { name: 'Pillow', parent: null, level: 1 },
  { name: 'Memory Foam Pillow', parent: 'Pillow', level: 2 },
  { name: 'Cervical Pillow', parent: 'Memory Foam Pillow', level: 3 },
  { name: 'Contour Pillow', parent: 'Memory Foam Pillow', level: 3 },
  { name: 'Ergonomic Pillow', parent: 'Memory Foam Pillow', level: 3 },
  { name: 'Neck Support Pillow', parent: 'Memory Foam Pillow', level: 3 },
  { name: 'Side Sleeper Pillow', parent: 'Memory Foam Pillow', level: 3 },
  { name: 'Back Sleeper Pillow', parent: 'Memory Foam Pillow', level: 3 },
];

/** 建立/确认市场树，返回主市场 id */
export function ensureMarketTree(marketplace = 'US'): { rootId: number; mainId: number } {
  const ids = new Map<string, number>();
  for (const node of MEMORY_FOAM_TREE) {
    const parentId = node.parent ? (ids.get(node.parent) ?? null) : null;
    const id = upsertMarketNode({
      name: node.name,
      parent_id: parentId,
      level: node.level,
      marketplace,
      source: 'mock-tree',
    });
    ids.set(node.name, id);
  }
  return { rootId: ids.get('Pillow')!, mainId: ids.get('Memory Foam Pillow')! };
}

function listChildMarkets(parentId: number): Array<{ id: number; name: string }> {
  const db = getDatabase();
  return db.prepare('SELECT id, name FROM markets WHERE parent_id = ?').all(parentId) as Array<{ id: number; name: string }>;
}

export async function runExistingMarketWorkflow(jobId: number): Promise<void> {
  const db = getDatabase();
  const job = getResearchJob(jobId)!;
  const profile = getActiveRuleProfile('amazon_us_memory_foam_v1') ?? getActiveRuleProfile();
  if (!profile) throw new Error('缺少可用 RuleProfile');
  const adapter = getAdapter('mock');

  try {
    transitionJob(jobId, 'planned');
    const marketName = job.target || 'Memory Foam Pillow';

    // plan：确认市场树
    await runStep(jobId, 'plan', () => {
      const tree = ensureMarketTree(job.marketplace);
      return { market_name: marketName, tree };
    });

    transitionJob(jobId, 'collecting');

    // collect_market：主市场 + 子市场概览
    const marketOverviews: RawMarketData[] = await runStep(jobId, 'collect_market', async () => {
      const main = await adapter.fetchMarketOverview({ market_name: marketName, marketplace: job.marketplace });
      const { mainId } = ensureMarketTree(job.marketplace);
      const children = listChildMarkets(mainId);
      const subs: RawMarketData[] = [];
      for (const c of children) {
        subs.push(await adapter.fetchMarketOverview({ market_name: c.name, marketplace: job.marketplace }));
      }
      recordDataTask({
        jobId,
        sourceName: 'mock',
        taskType: 'collect_market',
        target: marketName,
        status: 'success',
        result: { total: 1 + subs.length, success: 1 + subs.length, failed: 0 },
      });
      return [main, ...subs];
    });

    // collect_products：TOP100
    const products: RawProductData[] = await runStep(jobId, 'collect_products', async () => {
      const top = await adapter.fetchMarketProducts({ market_name: marketName, marketplace: job.marketplace }, 100);
      recordDataTask({
        jobId,
        sourceName: 'mock',
        taskType: 'collect_products',
        target: `${marketName} TOP100`,
        status: 'success',
        result: { total: top.length, success: top.length, failed: 0 },
      });
      return top;
    });

    transitionJob(jobId, 'normalizing');

    // normalize：市场 + 产品
    const normalized = await runStep(jobId, 'normalize', () => {
      const marketIds = marketOverviews.map((m) => normalizeMarketData(m, { is_demo: true, job_id: jobId, entityType: 'market' }).marketId);
      const productIds = products.map((p) => normalizeProductData(p, { is_demo: true, job_id: jobId, entityType: 'product' }).productId);
      return { market_ids: marketIds, product_ids: productIds };
    });

    // validate
    transitionJob(jobId, 'validating');
    await runStep(jobId, 'validate', () => {
      const allMissing = db.prepare('SELECT COUNT(*) AS c FROM missing_data_items WHERE research_job_id = ?').get(jobId) as { c: number };
      const critical = db
        .prepare('SELECT COUNT(*) AS c FROM missing_data_items WHERE research_job_id = ? AND required_for_decision = 1')
        .get(jobId) as { c: number };
      if (critical.c > 0) {
        // 演示数据关键字段齐备；若缺失则如实标记
        return { critical_missing: critical.c, all_missing: allMissing.c, valid: false };
      }
      return { critical_missing: 0, all_missing: allMissing.c, valid: true };
    });

    transitionJob(jobId, 'calculating');

    // calculate：市场趋势 / 集中度 / 新品占比
    const metrics = await runStep(jobId, 'calculate', () => {
      const mainId = normalized.market_ids[0]!;
      const snapshots = listMarketSnapshots(mainId);
      const g30 = growthFromSnapshots(snapshots, 30);
      const g90 = growthFromSnapshots(snapshots, 90);
      const latest = snapshots[snapshots.length - 1];
      const subMarkets = listChildMarkets(mainId).map((c) => {
        const s = listMarketSnapshots(c.id);
        return {
          name: c.name,
          growth30d: growthFromSnapshots(s, 30),
          monthly_sales: s[s.length - 1]?.monthly_sales ?? null,
        };
      });
      return {
        main_market_id: mainId,
        market_name: marketName,
        growth30d: g30,
        growth90d: g90,
        concentration_top10: latest?.top10_sales_share ?? null,
        concentration_top20: latest?.top20_sales_share ?? null,
        new_product_share: latest?.new_product_count != null && latest.product_count ? latest.new_product_count / latest.product_count : null,
        median_reviews: latest?.median_reviews ?? null,
        avg_price: latest?.avg_price ?? null,
        monthly_sales: latest?.monthly_sales ?? null,
        monthly_revenue: latest?.monthly_revenue ?? null,
        product_count: latest?.product_count ?? null,
        seller_count: latest?.seller_count ?? null,
        brand_count: latest?.brand_count ?? null,
        sub_markets: subMarkets,
      };
    });

    transitionJob(jobId, 'analyzing');

    // ai_analysis：市场结论 + 证据
    await runStep(jobId, 'ai_analysis', async () => {
      const missing = (db.prepare('SELECT field FROM missing_data_items WHERE research_job_id = ?').all(jobId) as Array<{ field: string }>).map((r) => r.field);
      const { insightId } = await generateInsight({
        agent: 'market',
        entityType: 'market',
        entityId: metrics.main_market_id,
        jobId,
        promptVersion: 'market-analysis.v1',
        data: { ...metrics, missing },
      });
      return { insight_id: insightId };
    });

    // snapshot 记录（快照已在 normalize 阶段写入）
    await runStep(jobId, 'snapshot', () => {
      const count = db.prepare('SELECT COUNT(*) AS c FROM market_snapshots WHERE market_id = ?').get(metrics.main_market_id) as { c: number };
      return { market_snapshots: count.c };
    });

    // report + 进入监控
    await runStep(jobId, 'report', () => {
      const mainId = findMarketNode(marketName, job.marketplace);
      if (mainId) addWatchlist({ item_type: 'market', item_id: mainId, watch_frequency: 'daily' });
      return { watchlist: ['market:main'] };
    });

    transitionJob(jobId, 'monitor_ready');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      transitionJob(jobId, 'failed', msg);
    } catch {
      // 若状态不允许 failed，忽略
    }
    throw e;
  }
}
