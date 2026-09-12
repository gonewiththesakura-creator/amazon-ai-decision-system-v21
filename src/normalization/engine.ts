/**
 * Data Normalization Engine（V2 §10-12）
 * 职责：
 *  1. 第三方字段 → 系统统一字段（数量、单位、口径）
 *  2. 缺失数据一律 null + missing_reason，禁止补 0
 *  3. 缺失写入 missing_data_items 队列
 */
import { getDatabase } from '../db/connection.js';
import type { RawMarketData, RawProductData, RawReviewData } from '../adapters/types.js';
import { getMode } from '../config/mode.js';
import { findMarketNode, findProductByAsin, saveMarketSnapshot, saveMarketSnapshotSeries, saveProductSnapshot, saveProductSnapshotSeries, upsertMarketNode, upsertProduct } from '../modules/snapshots/engine.js';

export interface MissingField {
  field: string;
  missing_reason: string;
  required_for_decision: boolean;
  manual_validation_required: boolean;
}

export interface NormalizedMarket {
  marketId: number;
  missing: MissingField[];
  isDemo: boolean;
}

export interface NormalizedProduct {
  productId: number;
  missing: MissingField[];
  isDemo: boolean;
}

export function recordMissingItems(params: {
  jobId?: number | null;
  entityType: string;
  entityId?: number | null;
  missing: MissingField[];
}): void {
  if (!params.missing.length) return;
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO missing_data_items (research_job_id, entity_type, entity_id, field, missing_reason, required_for_decision, manual_validation_required, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
  );
  const ts = new Date().toISOString();
  for (const m of params.missing) {
    stmt.run(params.jobId ?? null, params.entityType, params.entityId ?? null, m.field, m.missing_reason, m.required_for_decision ? 1 : 0, m.manual_validation_required ? 1 : 0, ts);
  }
}

function missingField(value: unknown, field: string, reason: string, requiredForDecision: boolean, manual = false): MissingField | null {
  if (value === null || value === undefined) {
    return { field, missing_reason: reason, required_for_decision: requiredForDecision, manual_validation_required: manual };
  }
  return null;
}

export interface NormalizeOptions {
  is_demo?: boolean;
  job_id?: number | null;
  entityType?: string;
  /** 是否写入快照历史 */
  persist_snapshots?: boolean;
}

/** V2.2 §30 Runtime Mock Guard：REAL 模式下 Normalize 前禁止任何 source='mock' 的原始数据进入（双保险） */
export function assertNoRuntimeMock(raw: Pick<RawMarketData, 'source'>, mode: string): void {
  if (mode === 'REAL' && raw.source === 'mock') {
    throw new Error(
      `Runtime Mock Guard: REAL 模式下 Normalize 前发现 raw.source='mock'（source=${raw.source}），禁止 Mock 数据进入生产链路`
    );
  }
}

/** 标准化市场数据：统一字段 → 存市场节点 + 快照；缺失字段记队列 */
export function normalizeMarketData(raw: RawMarketData, opts: NormalizeOptions = {}): NormalizedMarket {
  assertNoRuntimeMock(raw, getMode());
  const missing: MissingField[] = [
    missingField(raw.monthly_sales, 'monthly_sales', '数据源未提供月销量', true),
    missingField(raw.monthly_revenue, 'monthly_revenue', '数据源未提供月销售额', false),
    missingField(raw.product_count, 'product_count', '数据源未提供产品数', true),
    missingField(raw.avg_price, 'avg_price', '数据源未提供平均售价', false),
    missingField(raw.top10_sales_share, 'top10_sales_share', '数据源未提供 TOP10 集中度', false),
  ].filter((m): m is MissingField => m !== null);

  const marketId = upsertMarketNode({
    name: raw.market_name,
    marketplace: raw.marketplace,
    source: raw.source,
  });

  if (opts.persist_snapshots !== false) {
    saveMarketSnapshotSeries(marketId, raw, { is_demo: opts.is_demo ?? false });
  } else {
    saveMarketSnapshot(marketId, raw, { is_demo: opts.is_demo ?? false });
  }

  recordMissingItems({
    jobId: opts.job_id ?? null,
    entityType: opts.entityType ?? 'market',
    entityId: marketId,
    missing,
  });

  return { marketId, missing, isDemo: opts.is_demo ?? false };
}

/** 标准化产品数据：统一字段 → 存产品 + 快照；缺失字段记队列 */
export function normalizeProductData(raw: RawProductData, opts: NormalizeOptions = {}): NormalizedProduct {
  assertNoRuntimeMock(raw, getMode());
  const missing: MissingField[] = [
    missingField(raw.price, 'price', '数据源未提供价格', false),
    missingField(raw.review_count, 'review_count', '数据源未提供评论数', true),
    missingField(raw.rating, 'rating', '数据源未提供评分', false),
    missingField(raw.bsr, 'bsr', '数据源未提供 BSR 排名', false),
    missingField(raw.estimated_sales_30d, 'estimated_sales_30d', '数据源未提供 30D 销量（估算）', true),
  ].filter((m): m is MissingField => m !== null);

  let marketId: number | null = null;
  if (raw.market_name) {
    marketId = findMarketNode(raw.market_name, 'US') ?? upsertMarketNode({ name: raw.market_name, marketplace: 'US', source: raw.source });
  }

  const productId = upsertProduct({
    asin: raw.asin,
    brand: raw.brand,
    title: raw.title,
    image_url: raw.image_url,
    marketplace: 'US',
    market_id: marketId,
  });

  if (opts.persist_snapshots !== false) {
    saveProductSnapshotSeries(productId, raw, { is_demo: opts.is_demo ?? false });
  } else {
    saveProductSnapshot(productId, raw, { is_demo: opts.is_demo ?? false });
  }

  recordMissingItems({
    jobId: opts.job_id ?? null,
    entityType: opts.entityType ?? 'product',
    entityId: productId,
    missing,
  });

  return { productId, missing, isDemo: opts.is_demo ?? false };
}

/** 标准化评论数据 */
export function normalizeReviewData(raw: RawReviewData, opts: { is_demo?: boolean } = {}): number {
  const db = getDatabase();
  const productId = findProductByAsin(raw.asin);
  if (!productId) throw new Error(`评论所属产品不存在（ASIN=${raw.asin}），请先导入产品`);
  const res = db
    .prepare(
      `INSERT INTO reviews (product_id, text, rating, review_date, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      productId,
      raw.text,
      raw.rating,
      raw.review_date,
      opts.is_demo ? `${raw.source} [DEMO]` : raw.source,
      new Date().toISOString()
    );
  return Number(res.lastInsertRowid);
}

/** 校验数据完整性：required 字段是否齐备 */
export function hasRequiredData(missing: MissingField[], requiredForDecisionOnly = true): boolean {
  const relevant = requiredForDecisionOnly ? missing.filter((m) => m.required_for_decision) : missing;
  return relevant.length === 0;
}
