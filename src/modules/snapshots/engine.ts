/**
 * Snapshot 历史库（V2 §13）—— 追加式，永不覆盖
 * 同一 (market_id, snapshot_date) 或 (product_id, snapshot_date) 已存在则跳过
 */
import { getDatabase } from '../../db/connection.js';
import type { MarketSnapshot, ProductSnapshot, KeywordSnapshot } from '../../types/models.js';
import type { RawMarketData, RawMarketSnapshot, RawProductData, RawProductSnapshot } from '../../adapters/types.js';

export interface SnapshotWriteResult {
  inserted: boolean;
  id: number | null;
  reason?: string;
}

export function upsertMarketNode(params: {
  name: string;
  parent_id?: number | null;
  level?: number;
  marketplace?: string;
  category_id?: string | null;
  keywords?: string | null;
  source?: string;
}): number {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM markets WHERE name = ? AND marketplace = ?')
    .get(params.name, params.marketplace ?? 'US') as { id: number } | undefined;
  if (existing) return existing.id;
  const res = db
    .prepare(
      `INSERT INTO markets (name, parent_id, level, marketplace, category_id, keywords, active, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      params.name,
      params.parent_id ?? null,
      params.level ?? 1,
      params.marketplace ?? 'US',
      params.category_id ?? null,
      params.keywords ?? null,
      params.source ?? 'adapter',
      new Date().toISOString()
    );
  return Number(res.lastInsertRowid);
}

export function findMarketNode(name: string, marketplace = 'US'): number | null {
  const db = getDatabase();
  const row = db.prepare('SELECT id FROM markets WHERE name = ? AND marketplace = ?').get(name, marketplace) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

export function saveMarketSnapshot(
  marketId: number,
  raw: RawMarketData,
  opts: { is_demo?: boolean; source_metadata?: Record<string, unknown> }
): SnapshotWriteResult {
  const db = getDatabase();
  const latest = raw.snapshots?.length ? raw.snapshots[raw.snapshots.length - 1]! : null;
  const date = latest?.date ?? new Date().toISOString().slice(0, 10);
  const existing = db
    .prepare('SELECT id FROM market_snapshots WHERE market_id = ? AND snapshot_date = ?')
    .get(marketId, date) as { id: number } | undefined;
  if (existing) return { inserted: false, id: existing.id, reason: '同日快照已存在，跳过（历史不可覆盖）' };

  const res = db
    .prepare(
      `INSERT INTO market_snapshots
        (market_id, snapshot_date, monthly_sales, monthly_revenue, product_count, seller_count, brand_count,
         avg_price, median_price, avg_rating, median_reviews, new_product_count, top10_sales_share, top20_sales_share,
         source_metadata, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      marketId,
      date,
      latest?.monthly_sales ?? raw.monthly_sales,
      latest?.monthly_revenue ?? raw.monthly_revenue,
      latest?.product_count ?? raw.product_count,
      raw.seller_count,
      raw.brand_count,
      latest?.avg_price ?? raw.avg_price,
      latest?.median_price ?? raw.median_price,
      raw.avg_rating,
      raw.median_reviews,
      raw.new_product_count,
      raw.top10_sales_share,
      raw.top20_sales_share,
      JSON.stringify({
        source: raw.source,
        source_type: raw.source_type,
        collected_at: raw.collected_at,
        is_estimated: raw.is_estimated,
        confidence: raw.confidence,
        ...(opts.source_metadata ?? {}),
      }),
      opts.is_demo ? 1 : 0,
      new Date().toISOString()
    );
  return { inserted: true, id: Number(res.lastInsertRowid) };
}

/** 将历史快照序列（snapshots 数组）逐个写入，跳过已存在日期 */
export function saveMarketSnapshotSeries(
  marketId: number,
  raw: RawMarketData,
  opts: { is_demo?: boolean }
): SnapshotWriteResult[] {
  const series: RawMarketSnapshot[] = raw.snapshots?.length
    ? raw.snapshots
    : [{ date: new Date().toISOString().slice(0, 10), monthly_sales: raw.monthly_sales, monthly_revenue: raw.monthly_revenue, product_count: raw.product_count, avg_price: raw.avg_price, median_price: raw.median_price }];
  return series.map((s) =>
    saveMarketSnapshot(marketId, { ...raw, snapshots: [s] }, opts)
  );
}

export function upsertProduct(params: {
  asin: string;
  brand?: string | null;
  title: string;
  image_url?: string | null;
  marketplace?: string;
  market_id?: number | null;
  is_owned?: boolean;
  owned_sku_id?: number | null;
  source?: string;
}): number {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM products WHERE asin = ?').get(params.asin) as
    | { id: number }
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE products SET brand = COALESCE(?, brand), title = ?, image_url = COALESCE(?, image_url),
       market_id = COALESCE(?, market_id), is_owned = ?, owned_sku_id = COALESCE(?, owned_sku_id),
       source = COALESCE(?, source) WHERE id = ?`
    ).run(params.brand ?? null, params.title, params.image_url ?? null, params.market_id ?? null, params.is_owned ? 1 : 0, params.owned_sku_id ?? null, params.source ?? null, existing.id);
    return existing.id;
  }
  const res = db
    .prepare(
      `INSERT INTO products (asin, brand, title, image_url, marketplace, market_id, is_owned, owned_sku_id, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.asin,
      params.brand ?? null,
      params.title,
      params.image_url ?? null,
      params.marketplace ?? 'US',
      params.market_id ?? null,
      params.is_owned ? 1 : 0,
      params.owned_sku_id ?? null,
      params.source ?? 'import',
      new Date().toISOString()
    );
  return Number(res.lastInsertRowid);
}

export function findProductByAsin(asin: string): number | null {
  const db = getDatabase();
  const row = db.prepare('SELECT id FROM products WHERE asin = ?').get(asin) as { id: number } | undefined;
  return row?.id ?? null;
}

export function saveProductSnapshot(
  productId: number,
  raw: RawProductData,
  opts: { is_demo?: boolean; date?: string; source_metadata?: Record<string, unknown>; series?: boolean }
): SnapshotWriteResult {
  const db = getDatabase();
  const latest = raw.snapshots?.length ? raw.snapshots[raw.snapshots.length - 1]! : null;
  const date = opts.date ?? latest?.date ?? new Date().toISOString().slice(0, 10);
  const existing = db
    .prepare('SELECT id FROM product_snapshots WHERE product_id = ? AND snapshot_date = ?')
    .get(productId, date) as { id: number } | undefined;
  if (existing) return { inserted: false, id: existing.id, reason: '同日快照已存在，跳过（历史不可覆盖）' };

  const res = db
    .prepare(
      `INSERT INTO product_snapshots
        (product_id, snapshot_date, price, rating, review_count, bsr, estimated_sales, estimated_revenue, coupon, seller_count, source_metadata, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      productId,
      date,
      latest?.price ?? raw.price,
      latest?.rating ?? raw.rating,
      latest?.review_count ?? raw.review_count,
      latest?.bsr ?? raw.bsr,
      // V2.2 §26：系列快照历史期如实保留 null（不允许用 30D 总数兜底污染历史）
      latest?.estimated_sales ?? (opts.series ? null : raw.estimated_sales_30d),
      latest && latest.estimated_sales != null && (latest.price ?? raw.price) != null
        ? latest.estimated_sales * (latest.price ?? raw.price!)
        : opts.series
          ? null
          : raw.estimated_revenue_30d,
      raw.coupon,
      raw.seller_count,
      JSON.stringify({
        source: raw.source,
        source_type: raw.source_type,
        collected_at: raw.collected_at,
        is_estimated: raw.is_estimated,
        confidence: raw.confidence,
        ...(opts.source_metadata ?? {}),
      }),
      opts.is_demo ? 1 : 0,
      new Date().toISOString()
    );
  return { inserted: true, id: Number(res.lastInsertRowid) };
}

export function saveProductSnapshotSeries(
  productId: number,
  raw: RawProductData,
  opts: { is_demo?: boolean }
): SnapshotWriteResult[] {
  const series: RawProductSnapshot[] = raw.snapshots?.length
    ? raw.snapshots
    : [{ date: new Date().toISOString().slice(0, 10), price: raw.price, rating: raw.rating, review_count: raw.review_count, bsr: raw.bsr, estimated_sales: raw.estimated_sales_30d }];
  return series.map((s) =>
    saveProductSnapshot(productId, { ...raw, snapshots: [s] }, { is_demo: opts.is_demo, date: s.date, series: true })
  );
}

export function listMarketSnapshots(marketId: number): MarketSnapshot[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM market_snapshots WHERE market_id = ? ORDER BY snapshot_date')
    .all(marketId) as unknown as MarketSnapshot[];
}

export function listProductSnapshots(productId: number): ProductSnapshot[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM product_snapshots WHERE product_id = ? ORDER BY snapshot_date')
    .all(productId) as unknown as ProductSnapshot[];
}

export function listKeywordSnapshots(keywordId: number): KeywordSnapshot[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM keyword_snapshots WHERE keyword_id = ? ORDER BY date')
    .all(keywordId) as unknown as KeywordSnapshot[];
}

/** 由市场快照序列计算 30D/90D 增速（%）。不足两期返回 null */
export function growthFromSnapshots(
  snapshots: { snapshot_date: string; monthly_sales: number | null }[],
  windowDays: 30 | 90
): number | null {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const latest = sorted[sorted.length - 1]!;
  // 找到距最新约 windowDays 天的那一期（允许 ±15 天容差）
  const latestTs = new Date(latest.snapshot_date + 'T00:00:00Z').getTime();
  let best: { snapshot_date: string; monthly_sales: number | null } | null = null;
  let bestDist = Infinity;
  for (const s of sorted) {
    const ts = new Date(s.snapshot_date + 'T00:00:00Z').getTime();
    const dist = Math.abs(ts - (latestTs - windowDays * 86400000));
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  if (!best || best.snapshot_date === latest.snapshot_date) return null;
  if (best.monthly_sales == null || latest.monthly_sales == null) return null;
  if (best.monthly_sales === 0) return null;
  return Math.round(((latest.monthly_sales - best.monthly_sales) / best.monthly_sales) * 1000) / 10;
}

/** 由产品快照序列计算指定窗口的销量增速（%） */
export function growthFromProductSnapshots(
  snapshots: { snapshot_date: string; estimated_sales: number | null }[],
  windowDays: 30 | 90
): number | null {
  const mapped = snapshots.map((s) => ({ snapshot_date: s.snapshot_date, monthly_sales: s.estimated_sales }));
  return growthFromSnapshots(mapped, windowDays);
}
