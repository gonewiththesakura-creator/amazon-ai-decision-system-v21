/**
 * Workflow: owned_product —— 自有 SKU 竞争表现诊断（V2 §16；V2.2 §8/§9）
 * 多 Provider：owned_orders → Amazon；market_growth / top_products → SellerSprite；inventory → Amazon（optional）
 * SKU vs 市场 vs 直接竞品 → 相对表现 → AI 诊断 → 证据 → 监控
 */
import { getDatabase } from '../db/connection.js';
import { getResearchJob, transitionJob } from '../modules/research/job.js';
import { normalizeMarketData, normalizeProductData } from '../normalization/engine.js';
import {
  findMarketNode,
  growthFromProductSnapshots,
  growthFromSnapshots,
  listMarketSnapshots,
  listProductSnapshots,
  upsertProduct,
} from '../modules/snapshots/engine.js';
import { computeRelativePerformance, percentile } from '../modules/rules/engine.js';
import { getActiveRuleProfile } from '../modules/rules/profile.js';
import { generateInsight } from '../ai/service.js';
import { addWatchlist, recordDataTask, runStep } from './helpers.js';
import type { RawMarketData, RawProductData } from '../adapters/types.js';
import type { MarketResearchProvider, OwnedBusinessProvider } from '../adapters/providers/types.js';
import { getCapabilityProvider, type WorkflowDataContext } from './context.js';
import type { CompetitorChange } from '../ai/agents/sku-agent.js';

/**
 * V2.2 §8/§9：Owned Product Workflow —— 数据来自多 Provider（禁止 oneProviderForEverything）
 * - owned_orders → Amazon SP-API / Amazon Import（自有真实销量，优先级最高）
 * - market_growth / top_products → SellerSprite（市场/竞品）
 * - inventory → Amazon（optional，本版不阻塞）
 */
export async function runOwnedProductWorkflow(jobId: number, ctx: WorkflowDataContext): Promise<void> {
  const db = getDatabase();
  const job = getResearchJob(jobId)!;
  const profile = getActiveRuleProfile('amazon_us_memory_foam_v1') ?? getActiveRuleProfile();
  if (!profile) throw new Error('缺少可用 RuleProfile');

  // V2.2 §9：按能力分别取 Provider
  const ownedCtx = ctx.providers['owned_orders'];
  const marketCtx = ctx.providers['market_growth'];
  const topCtx = ctx.providers['top_products'];
  const ownedProvider = getCapabilityProvider<OwnedBusinessProvider>(ctx, 'owned_orders');
  const marketProvider = getCapabilityProvider<MarketResearchProvider>(ctx, 'market_growth');
  const topProductsProvider = getCapabilityProvider<MarketResearchProvider>(ctx, 'top_products');
  const isDemo = ownedCtx.isMock && marketCtx.isMock && topCtx.isMock;

  try {
    transitionJob(jobId, 'planned');

    // plan：定位自有 SKU + 所属市场
    const target = await runStep(jobId, 'plan', () => {
      const owned = db
        .prepare(
          `SELECT o.*, m.name AS market_name FROM owned_products o
           LEFT JOIN markets m ON o.market_id = m.id
           WHERE o.sku = ? OR o.asin = ?`
        )
        .get(job.target, job.target) as
        | { id: number; sku: string; asin: string; internal_name: string; market_id: number | null; market_name: string | null; image_url: string | null }
        | undefined;
      if (!owned) throw new Error(`自有 SKU 不存在: ${job.target}，请先在设置中录入`);
      return owned;
    });

    transitionJob(jobId, 'collecting');

    // collect_products：SKU 实际销量（owned_orders）+ 市场 TOP 竞品（top_products）
    const collected = await runStep(jobId, 'collect_products', async () => {
      // V2.2 §8：SKU 自有销量来自 Amazon（owned_orders），不再用 Mock 的 fetchProductDetail
      const orders = await ownedProvider.getOrders({ from: '2026-06-01', to: '2026-09-01' });
      const skuOrders = orders.filter((o) => o.asin === target.asin || o.asin === target.sku);
      // 订单 → 按日聚合 units，再聚合成 4 期快照（90/30/7/0 天前，30 天滚动窗口销量）
      const daily = new Map<string, number>();
      for (const o of skuOrders) daily.set(o.date, (daily.get(o.date) ?? 0) + o.units);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const DAY = 86400000;
      const snapshotWindows = [90, 30, 7, 0] as const;
      const skuSnapshots = snapshotWindows.map((w) => {
        const from = new Date(today.getTime() - (w + 30) * DAY);
        const to = new Date(today.getTime() - w * DAY);
        let sum = 0;
        for (const [date, u] of daily) {
          const d = new Date(date + 'T00:00:00Z').getTime();
          if (d >= from.getTime() && d < to.getTime()) sum += u;
        }
        return { date: to.toISOString().slice(0, 10), price: null, rating: null, review_count: null, bsr: null, estimated_sales: sum > 0 ? sum : null };
      });
      const totalUnits = skuOrders.reduce((s, o) => s + (o.units ?? 0), 0);
      const totalRevenue = skuOrders.reduce((s, o) => s + (o.revenue ?? 0), 0);
      const skuRaw: RawProductData = {
        asin: target.asin,
        brand: null,
        title: target.internal_name || target.sku,
        image_url: target.image_url,
        market_name: target.market_name,
        price: null,
        rating: null,
        review_count: null,
        bsr: null,
        estimated_sales_30d: totalUnits > 0 ? totalUnits : null,
        estimated_revenue_30d: totalRevenue > 0 ? totalRevenue : null,
        coupon: null,
        seller_count: null,
        source: ownedCtx.name,
        source_type: 'amazon_owned',
        collected_at: new Date().toISOString(),
        is_estimated: false,
        confidence: 1,
        snapshots: skuSnapshots,
      };
      const marketName = target.market_name ?? 'Memory Foam Pillow';
      const all = await topProductsProvider.getTopProducts({ market_name: marketName, marketplace: job.marketplace, limit: 100 });
      recordDataTask({
        jobId,
        sourceName: `${ownedCtx.name}+${topCtx.name}`,
        taskType: 'collect_products',
        target: `${target.sku} + ${marketName} TOP100`,
        status: 'success',
        result: { total: 1 + all.length, success: 1 + all.length, failed: 0 },
      });
      return { skuRaw, marketName, competitors: all };
    });

    transitionJob(jobId, 'normalizing');

    // normalize：SKU + 市场（真实画像含快照序列）+ 竞品（is_demo 由 Provider 决定，V2.2 §12）
    const normalized = await runStep(jobId, 'normalize', async () => {
      const marketRaw = collected.skuRaw.market_name ?? collected.marketName;
      // 市场画像（market_growth 能力，含快照序列 → 增速可算）
      const marketOverview = await marketProvider.getMarketOverview({ market_name: marketRaw, marketplace: job.marketplace });
      const marketId = normalizeMarketData(marketOverview, { is_demo: marketCtx.isMock, job_id: jobId, entityType: 'market' }).marketId;

      const skuProductId = normalizeProductData(collected.skuRaw, { is_demo: ownedCtx.isMock, job_id: jobId, entityType: 'product' }).productId;
      // 关联自有 SKU
      db.prepare('UPDATE products SET is_owned = 1, owned_sku_id = ?, market_id = COALESCE(market_id, ?) WHERE id = ?').run(target.id, marketId, skuProductId);
      db.prepare('UPDATE owned_products SET market_id = COALESCE(market_id, ?) WHERE id = ?').run(marketId, target.id);

      const competitorIds = collected.competitors.map((c) =>
        normalizeProductData(c, { is_demo: topCtx.isMock, job_id: jobId, entityType: 'product' }).productId
      );
      return { skuProductId, marketId, competitorIds };
    });

    // validate + 进入计算
    transitionJob(jobId, 'validating');
    await runStep(jobId, 'validate', () => {
      const critical = db
        .prepare('SELECT COUNT(*) AS c FROM missing_data_items WHERE research_job_id = ? AND required_for_decision = 1')
        .get(jobId) as { c: number };
      return { critical_missing: critical.c, valid: critical.c === 0 };
    });
    transitionJob(jobId, 'calculating');

    // 竞品关系建立 + 全部确定性计算
    const calc = await runStep(jobId, 'calculate', () => {
      const skuSnaps = listProductSnapshots(normalized.skuProductId);
      const skuG30 = growthFromProductSnapshots(skuSnaps, 30);
      const skuG90 = growthFromProductSnapshots(skuSnaps, 90);

      const marketSnaps = listMarketSnapshots(normalized.marketId);
      const marketG30 = growthFromSnapshots(marketSnaps, 30);

      // 竞品画像
      const competitorRows = normalized.competitorIds
        .map((pid) => {
          const s = listProductSnapshots(pid);
          const g30 = growthFromProductSnapshots(s, 30);
          const latest = s[s.length - 1];
          const prev30 = s.find((x) => x.snapshot_date <= latest!.snapshot_date) ?? latest;
          const priceChange = latest?.price != null && prev30?.price ? Math.round(((latest.price - prev30.price) / prev30.price) * 1000) / 10 : null;
          return { pid, g30, latest, priceChange };
        })
        .filter((r) => r.latest);

      const growths = competitorRows.map((r) => r.g30 ?? 0);
      const growthP80 = growths.length ? growths.sort((a, b) => b - a)[Math.floor(growths.length * 0.2)] ?? 0 : 0;
      const priceBand = competitorRows.map((r) => r.latest!.price ?? 0).filter((p) => p > 0);
      const myPrice = skuSnaps[skuSnaps.length - 1]?.price ?? null;

      // 竞品分组（V2 §19）
      const direct: number[] = [];
      const fastGrowth: number[] = [];
      const top100: number[] = [];
      const benchmark: number[] = [];
      const pricePeer: number[] = [];

      for (const r of competitorRows) {
        top100.push(r.pid);
        if (r.g30 != null && r.g30 > growthP80) fastGrowth.push(r.pid);
        if (myPrice != null && r.latest!.price != null && Math.abs(r.latest!.price - myPrice) / myPrice <= 0.15) {
          pricePeer.push(r.pid);
          direct.push(r.pid); // 同价格带 + 高销量视为直接竞品
        }
      }
      // benchmark：Review 最高的 3 个
      const byReview = [...competitorRows].sort((a, b) => (b.latest!.review_count ?? 0) - (a.latest!.review_count ?? 0));
      benchmark.push(...byReview.slice(0, 3).map((r) => r.pid));

      const insertRel = db.prepare(
        `INSERT INTO competitor_relations (owned_product_id, competitor_product_id, type, similarity_score, reason, created_at, last_verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const ts = new Date().toISOString();
      const seen = new Set<string>();
      const addRel = (type: string, pid: number, score: number | null, reason: string) => {
        const key = `${type}:${pid}`;
        if (seen.has(key)) return;
        seen.add(key);
        insertRel.run(target.id, pid, type, score, reason, ts, ts);
      };
      direct.forEach((pid) => addRel('direct', pid, 0.8, '同市场同价格带高销量'));
      fastGrowth.forEach((pid) => addRel('fast_growth', pid, null, `30D 增速 > 市场 P80 (${growthP80}%)`));
      top100.forEach((pid) => addRel('top100', pid, null, 'TOP100'));
      benchmark.forEach((pid) => addRel('benchmark', pid, null, 'Review 最高标杆'));
      pricePeer.forEach((pid) => addRel('price_peer', pid, null, '同价格带'));

      // 竞品变化（价格/销量/排名/评论）
      const competitorChanges: CompetitorChange[] = competitorRows
        .map((r) => {
          const prod = db.prepare('SELECT asin, title FROM products WHERE id = ?').get(r.pid) as { asin: string; title: string } | undefined;
          if (!prod) return null;
          const latest = r.latest!;
          const prev = listProductSnapshots(r.pid).find((x) => x.snapshot_date < latest.snapshot_date) ?? latest;
          const out: CompetitorChange[] = [];
          if (r.priceChange != null && r.priceChange <= -3) out.push({ asin: prod.asin, title: prod.title.slice(0, 40), change_type: 'price_drop', value: Math.abs(r.priceChange) });
          if (r.priceChange != null && r.priceChange >= 3) out.push({ asin: prod.asin, title: prod.title.slice(0, 40), change_type: 'price_rise', value: r.priceChange });
          if (r.g30 != null && r.g30 >= 15) out.push({ asin: prod.asin, title: prod.title.slice(0, 40), change_type: 'sales_up', value: r.g30 });
          if (latest.bsr != null && prev.bsr != null && prev.bsr > 0 && (prev.bsr - latest.bsr) / prev.bsr >= 0.3) {
            out.push({ asin: prod.asin, title: prod.title.slice(0, 40), change_type: 'rank_up', value: Math.round(((prev.bsr - latest.bsr) / prev.bsr) * 100) });
          }
          if (latest.review_count != null && prev.review_count != null && prev.review_count > 0 && (latest.review_count - prev.review_count) / prev.review_count >= 0.5) {
            out.push({ asin: prod.asin, title: prod.title.slice(0, 40), change_type: 'review_surge', value: Math.round(((latest.review_count - prev.review_count) / prev.review_count) * 100) });
          }
          return out;
        })
        .flat()
        .filter((c): c is CompetitorChange => c !== null)
        .sort((a, b) => b.value - a.value)
        .slice(0, 15);

      // 相对表现（规则引擎）
      const rel = computeRelativePerformance(skuG30, marketG30, profile);

      // 百分位
      const salesPct = percentile(skuSnaps[skuSnaps.length - 1]?.estimated_sales ?? null, competitorRows.map((r) => r.latest!.estimated_sales ?? 0));
      const pricePct = percentile(myPrice, priceBand);
      const reviewPct = percentile(skuSnaps[skuSnaps.length - 1]?.review_count ?? null, competitorRows.map((r) => r.latest!.review_count ?? 0));

      // 记录规则执行
      db.prepare(
        `INSERT INTO rule_executions (research_job_id, rule_profile_id, rule_type, input_json, output_json, created_at)
         VALUES (?, ?, 'relative_performance', ?, ?, ?)`
      ).run(jobId, profile.id, JSON.stringify({ sku_growth: skuG30, market_growth: marketG30 }), JSON.stringify(rel), new Date().toISOString());

      return {
        skuG30,
        skuG90,
        marketG30,
        relative: rel,
        percentile: { sales: salesPct, price: pricePct, review: reviewPct },
        competitorChanges,
        counts: { direct: direct.length, fast_growth: fastGrowth.length, top100: top100.length, benchmark: benchmark.length, price_peer: pricePeer.length },
      };
    });

    transitionJob(jobId, 'analyzing');

    // ai_analysis：SKU 诊断 + 证据（使用 calculate 的真实指标）
    await runStep(jobId, 'ai_analysis', async () => {
      const missing = (db.prepare('SELECT field FROM missing_data_items WHERE research_job_id = ?').all(jobId) as Array<{ field: string }>).map((r) => r.field);
      // 明确标注缺失的运营类数据（V2 §47）
      const opMissing = ['广告数据', 'Sessions', 'CVR'];
      for (const f of opMissing) {
        db.prepare(
          `INSERT INTO missing_data_items (research_job_id, entity_type, entity_id, field, missing_reason, required_for_decision, manual_validation_required, status, created_at)
           VALUES (?, 'owned_product', ?, ?, ?, 0, 1, 'open', ?)`
        ).run(jobId, target.id, f, '数据源未提供（运营模块数据）', new Date().toISOString());
      }
      const { insightId } = await generateInsight({
        agent: 'sku',
        entityType: 'owned_product',
        entityId: target.id,
        jobId,
        promptVersion: 'owned-sku-analysis.v1',
        data: {
          sku_name: target.sku,
          asin: target.asin,
          internal_name: target.internal_name,
          market_name: target.market_name ?? 'Memory Foam Pillow',
          market_growth30d: calc.marketG30,
          sku_growth30d: calc.skuG30,
          sku_growth90d: calc.skuG90,
          relative_delta: calc.relative.relative_delta,
          relative_grade: calc.relative.grade,
          percentile_sales: calc.percentile.sales,
          percentile_price: calc.percentile.price,
          percentile_review: calc.percentile.review,
          competitor_changes: calc.competitorChanges,
          missing: [...missing, ...opMissing],
          source: `${ownedCtx.name}+${marketCtx.name}+${topCtx.name}`,
        },
      });
      return { insight_id: insightId };
    });

    // report：快照与监控
    await runStep(jobId, 'report', () => {
      addWatchlist({ item_type: 'owned_product', item_id: target.id, watch_frequency: 'daily' });
      addWatchlist({ item_type: 'market', item_id: normalized.marketId, watch_frequency: 'daily' });
      const rels = db.prepare('SELECT DISTINCT competitor_product_id FROM competitor_relations WHERE owned_product_id = ?').all(target.id) as Array<{ competitor_product_id: number }>;
      for (const r of rels) {
        addWatchlist({ item_type: 'product', item_id: r.competitor_product_id, watch_frequency: 'daily' });
      }
      return { watchlist: `owned:${target.id}, competitors:${rels.length}` };
    });

    transitionJob(jobId, 'monitor_ready');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      transitionJob(jobId, 'failed', msg);
    } catch {
      /* 状态不允许则忽略 */
    }
    throw e;
  }
}


