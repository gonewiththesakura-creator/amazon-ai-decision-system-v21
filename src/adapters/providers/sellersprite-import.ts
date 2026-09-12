/**
 * SellerSprite Import Provider（V2.1 §1.1C；V2.2 §19/§28）
 * 真实导出文件兜底：已导入的 ReverseASIN / 关键词文件 → 业务数据（Raw → Normalize）。
 * healthCheckRemote = 存在 sellersprite 真实导入记录才 CONNECTED。
 * getMarketOverview 由 TOP 产品真实快照聚合（is_estimated=true，来源可追溯）；
 * getKeywordMetrics 从真实关键词快照读取；全部数据带 provenance != MOCK。
 */
import { getDatabase } from '../../db/connection.js';
import { ProviderUnavailableError, type Capability, type MarketResearchProvider, type ProviderBase, type ProviderConnectionStatus, type ProviderHealthResult } from './types.js';
import type { RawKeywordData, RawMarketData, RawProductData, RawReviewData } from '../types.js';

interface ProductSnapshotRow {
  asin: string;
  brand: string | null;
  title: string;
  image_url: string | null;
  snapshot_date: string;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  bsr: number | null;
  estimated_sales: number | null;
  estimated_revenue: number | null;
  source_metadata: string | null;
  is_demo: number;
}

export class SellerSpriteImportProvider implements ProviderBase, MarketResearchProvider {
  readonly name = 'sellersprite_import';
  readonly isMock = false;
  readonly capabilities: Capability[] = ['keyword_volume', 'top_products', 'market_size', 'market_growth', 'review_text'];

  private lastHealth: ProviderHealthResult | null = null;

  getLastHealth(): ProviderHealthResult | null {
    return this.lastHealth;
  }

  getStatus(): ProviderConnectionStatus {
    return this.hasImport() ? 'CONNECTED' : 'UNCONFIGURED';
  }

  getStatusDetail(): string {
    return this.hasImport() ? `已连接（${this.importCount()} 批真实 SellerSprite 导入）` : '尚未导入 SellerSprite 真实文件';
  }

  healthCheck(): Capability[] {
    return this.getStatus() === 'CONNECTED' ? this.capabilities : [];
  }

  async healthCheckRemote(): Promise<ProviderHealthResult> {
    const ok = this.hasImport();
    const h: ProviderHealthResult = ok
      ? { status: 'CONNECTED', checkedAt: new Date().toISOString(), latencyMs: 0, capabilities: this.capabilities }
      : { status: 'UNCONFIGURED', checkedAt: new Date().toISOString(), capabilities: [], errorCode: 'UNCONFIGURED', errorMessage: '尚未导入 SellerSprite 真实文件' };
    this.lastHealth = h;
    return h;
  }

  private hasImport(): boolean {
    try {
      const db = getDatabase();
      const n = db.prepare("SELECT COUNT(*) AS n FROM raw_ingestions WHERE source = 'sellersprite'").get() as { n: number };
      return n.n > 0;
    } catch {
      return false;
    }
  }

  private importCount(): number {
    try {
      const db = getDatabase();
      const n = db.prepare("SELECT COUNT(*) AS n FROM raw_ingestions WHERE source = 'sellersprite'").get() as { n: number };
      return n.n;
    } catch {
      return 0;
    }
  }

  /** 最新一批非 demo 产品快照（真实导入，provenance != MOCK） */
  private latestProductSnapshots(limit: number): ProductSnapshotRow[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT p.asin, p.brand, p.title, p.image_url, ps.snapshot_date, ps.price, ps.rating, ps.review_count, ps.bsr,
                ps.estimated_sales, ps.estimated_revenue, ps.source_metadata, ps.is_demo
         FROM product_snapshots ps JOIN products p ON p.id = ps.product_id
         WHERE ps.is_demo = 0 AND ps.estimated_sales IS NOT NULL
           AND ps.snapshot_date = (SELECT MAX(snapshot_date) FROM product_snapshots WHERE product_id = ps.product_id)
         ORDER BY ps.estimated_sales DESC
         LIMIT ?`
      )
      .all(limit) as unknown as ProductSnapshotRow[];
    return rows;
  }

  private assertConnected(): void {
    if (!this.hasImport()) {
      throw new ProviderUnavailableError(this.name, 'UNCONFIGURED', '尚未导入 SellerSprite 真实文件，无法提供业务数据');
    }
  }

  /** 市场画像：由 TOP 产品真实快照聚合（真实估算） */
  async getMarketOverview(input: { market_name: string; marketplace: string; keywords?: string[] }): Promise<RawMarketData> {
    this.assertConnected();
    const tops = this.latestProductSnapshots(200);
    if (tops.length === 0) {
      throw new ProviderUnavailableError(this.name, this.getStatus(), '已导入但无产品快照（需 ReverseASIN 文件）');
    }
    const prices = tops.map((t) => t.price).filter((p): p is number => p != null && p > 0);
    const reviews = tops.map((t) => t.review_count).filter((r): r is number => r != null);
    const sales = tops.reduce((s, t) => s + (t.estimated_sales ?? 0), 0);
    const top10Sales = tops.slice(0, 10).reduce((s, t) => s + (t.estimated_sales ?? 0), 0);
    const avgPrice = prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null;
    const medianPrice = prices.length ? (prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)] ?? null) : null;
    const medianReviews = reviews.length ? (reviews.slice().sort((a, b) => a - b)[Math.floor(reviews.length / 2)] ?? null) : null;
    const now = new Date().toISOString();
    return {
      market_name: input.market_name,
      marketplace: input.marketplace,
      monthly_sales: sales > 0 ? sales : null,
      monthly_revenue: tops.reduce((s, t) => s + (t.estimated_revenue ?? 0), 0) > 0 ? Math.round(tops.reduce((s, t) => s + (t.estimated_revenue ?? 0), 0) * 100) / 100 : null,
      product_count: tops.length,
      seller_count: null,
      brand_count: new Set(tops.map((t) => t.brand).filter(Boolean)).size,
      avg_price: avgPrice,
      median_price: medianPrice,
      avg_rating: tops.some((t) => t.rating != null) ? Math.round((tops.reduce((s, t) => s + (t.rating ?? 0), 0) / tops.filter((t) => t.rating != null).length) * 100) / 100 : null,
      median_reviews: medianReviews ?? null,
      new_product_count: null,
      top10_sales_share: sales > 0 ? Math.round((top10Sales / sales) * 1000) / 10 : null,
      top20_sales_share: null,
      source: 'sellersprite_import',
      source_type: 'aggregate_from_import',
      collected_at: now,
      is_estimated: true,
      confidence: 0.7,
      snapshots: [
        {
          date: tops[0]!.snapshot_date,
          monthly_sales: sales > 0 ? sales : null,
          monthly_revenue: null,
          product_count: tops.length,
          avg_price: avgPrice,
          median_price: medianPrice ?? null,
        },
      ],
    };
  }

  /** TOP 产品：真实快照排序 */
  async getTopProducts(input: { market_name: string; marketplace: string; limit?: number }): Promise<RawProductData[]> {
    this.assertConnected();
    const rows = this.latestProductSnapshots(input.limit ?? 100);
    return rows.map((r) => this.rowToRaw(r));
  }

  async getProductMetrics(input: { asin: string; marketplace: string }): Promise<RawProductData> {
    this.assertConnected();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT p.asin, p.brand, p.title, p.image_url, ps.snapshot_date, ps.price, ps.rating, ps.review_count, ps.bsr,
                ps.estimated_sales, ps.estimated_revenue, ps.source_metadata, ps.is_demo
         FROM product_snapshots ps JOIN products p ON p.id = ps.product_id
         WHERE p.asin = ? AND ps.is_demo = 0
         ORDER BY ps.snapshot_date DESC LIMIT 1`
      )
      .get(input.asin) as ProductSnapshotRow | undefined;
    if (!row) throw new ProviderUnavailableError(this.name, this.getStatus(), `导入数据中无 ASIN ${input.asin}`);
    return this.rowToRaw(row);
  }

  /** 关键词指标：真实关键词快照（ABA 周排名 / 点击 / 展示 / 转化） */
  async getKeywordMetrics(input: { keyword: string; marketplace: string }): Promise<RawKeywordData> {
    this.assertConnected();
    const db = getDatabase();
    const kw = db.prepare('SELECT id FROM keywords WHERE keyword = ? LIMIT 1').get(input.keyword) as { id: number } | undefined;
    if (!kw) throw new ProviderUnavailableError(this.name, this.getStatus(), `导入数据中无关键词 ${input.keyword}`);
    const row = db
      .prepare('SELECT * FROM keyword_snapshots WHERE keyword_id = ? AND is_demo = 0 ORDER BY date DESC LIMIT 1')
      .get(kw.id) as
      | { date: string; search_volume: number | null; trend: number | null; competing_products: number | null; aba_click_share: number | null; aba_conversion_share: number | null; bid: number | null; source_metadata: string | null }
      | undefined;
    if (!row) throw new ProviderUnavailableError(this.name, this.getStatus(), `关键词 ${input.keyword} 无真实快照`);
    return {
      keyword: input.keyword,
      search_volume: row.search_volume,
      trend: row.trend,
      competing_products: row.competing_products,
      aba_click_share: row.aba_click_share,
      aba_conversion_share: row.aba_conversion_share,
      bid: row.bid,
      source: 'sellersprite_import',
      source_type: 'keyword_snapshot',
      collected_at: row.date + 'T00:00:00.000Z',
    };
  }

  /** 评论：已导入评论（raw_records 中 review 类型） */
  async getReviews(input: { asin: string; limit?: number }): Promise<RawReviewData[]> {
    this.assertConnected();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT raw_payload FROM raw_records rr JOIN raw_ingestions ri ON ri.id = rr.ingestion_id
         WHERE ri.source = 'sellersprite' AND rr.record_type LIKE '%review%' AND raw_payload LIKE ?
         ORDER BY rr.id DESC LIMIT ?`
      )
      .all(`%${input.asin}%`, input.limit ?? 60) as Array<{ raw_payload: string }>;
    return rows
      .map((r) => {
        const p = JSON.parse(r.raw_payload) as Record<string, unknown>;
        return {
          asin: String(p.asin ?? input.asin),
          text: String(p.review ?? p.text ?? p['评论内容'] ?? ''),
          rating: typeof p.rating === 'number' ? p.rating : null,
          review_date: String(p.review_date ?? p['评论日期'] ?? null),
          source: 'sellersprite_import',
        };
      })
      .filter((r) => r.text);
  }

  private rowToRaw(r: ProductSnapshotRow): RawProductData {
    return {
      asin: r.asin,
      brand: r.brand,
      title: r.title,
      image_url: r.image_url,
      market_name: null,
      price: r.price,
      rating: r.rating,
      review_count: r.review_count,
      bsr: r.bsr,
      estimated_sales_30d: r.estimated_sales,
      estimated_revenue_30d: r.estimated_revenue,
      coupon: null,
      seller_count: null,
      source: 'sellersprite_import',
      source_type: 'imported_product',
      collected_at: new Date().toISOString(),
      is_estimated: true,
      confidence: 0.8,
      snapshots: [
        {
          date: r.snapshot_date,
          price: r.price,
          rating: r.rating,
          review_count: r.review_count,
          bsr: r.bsr,
          estimated_sales: r.estimated_sales,
        },
      ],
    };
  }
}

export const sellerspriteImport = new SellerSpriteImportProvider();
