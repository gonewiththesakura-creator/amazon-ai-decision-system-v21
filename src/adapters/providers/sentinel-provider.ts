/**
 * Sentinel Real Provider（V2.2 §31/§32/§50）
 * 测试专用真实 Provider（isMock=false）：固定已知值注入 REAL 数据链，
 * 用于验证"REAL 模式最终 Snapshot/Metric/Evidence 必须来自真实 Provider"。
 *  - sentinel_market：market_monthly_sales=987654（Evidence 必须出现）
 *  - sentinel_owned：Amazon owned_orders=4321 + SellerSprite market_growth=17.89（相对表现可算）
 * 仅当 SENTINEL_PROVIDER=1 时注册（不污染生产运行）。
 */
import { ProviderError, type AdvertisingProvider, type Capability, type CostProvider, type MarketResearchProvider, type OwnedBusinessProvider, type ProviderBase, type ProviderConnectionStatus, type ProviderHealthResult } from './types.js';
import type { RawKeywordData, RawMarketData, RawProductData, RawReviewData } from '../types.js';

const DAY = 86400000;

export interface SentinelConfig {
  /** 'market_987654' | 'owned_4321' */
  mode: 'market_987654' | 'owned_4321';
  marketplace?: string;
}

const SENTINEL_OWNED_ASIN = 'B0SENTINEL0001';

export class SentinelRealProvider implements ProviderBase, MarketResearchProvider, OwnedBusinessProvider, AdvertisingProvider, CostProvider {
  readonly isMock = false;
  readonly capabilities: Capability[] = [
    'market_size', 'market_growth', 'top_products', 'estimated_sales',
    'keyword_volume', 'review_text', 'owned_orders', 'inventory',
    'listing_status', 'ad_metrics', 'search_terms', 'product_fees', 'supply_chain',
  ];

  private lastHealth: ProviderHealthResult | null = null;

  constructor(
    readonly name: string,
    private readonly config: SentinelConfig
  ) {}

  getLastHealth(): ProviderHealthResult | null {
    return this.lastHealth;
  }

  getStatus(): ProviderConnectionStatus {
    return 'CONNECTED';
  }

  getStatusDetail(): string {
    return `Sentinel 真实 Provider（${this.config.mode}，isMock=false，测试专用）`;
  }

  healthCheck(): Capability[] {
    return this.capabilities;
  }

  async healthCheckRemote(): Promise<ProviderHealthResult> {
    const h: ProviderHealthResult = {
      status: 'CONNECTED',
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
      capabilities: this.capabilities,
      errorMessage: `Sentinel ${this.config.mode} 已连接`,
    };
    this.lastHealth = h;
    return h;
  }

  // ===== MarketResearchProvider =====
  async getMarketOverview(input: { market_name: string; marketplace: string; keywords?: string[] }): Promise<RawMarketData> {
    void input;
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (this.config.mode === 'market_987654') {
      const dates = [90, 60, 30, 7, 0].map((d) => iso(new Date(now.getTime() - d * DAY)));
      const sales = [820000, 870000, 920000, 955000, 987654];
      return {
        market_name: input.market_name,
        marketplace: input.marketplace,
        monthly_sales: 987654,
        monthly_revenue: 9876540,
        product_count: 9200,
        seller_count: 2100,
        brand_count: 1450,
        avg_price: 34.5,
        median_price: 34,
        avg_rating: 4.3,
        median_reviews: 210,
        new_product_count: 552,
        top10_sales_share: 42,
        top20_sales_share: 61,
        source: this.name,
        source_type: 'sentinel',
        collected_at: new Date().toISOString(),
        is_estimated: false,
        confidence: 1,
        snapshots: dates.map((date, i) => ({ date, monthly_sales: sales[i]!, monthly_revenue: null, product_count: 9200, avg_price: 34.5, median_price: 34 })),
      };
    }
    // owned_4321：市场 30D 增速 = 17.89%
    const d30 = iso(new Date(now.getTime() - 30 * DAY));
    const d0 = iso(now);
    return {
      market_name: input.market_name,
      marketplace: input.marketplace,
      monthly_sales: 117.89,
      monthly_revenue: 1178.9,
      product_count: 9200,
      seller_count: 2100,
      brand_count: 1450,
      avg_price: 34.5,
      median_price: 34,
      avg_rating: 4.3,
      median_reviews: 210,
      new_product_count: 552,
      top10_sales_share: 42,
      top20_sales_share: 61,
      source: this.name,
      source_type: 'sentinel',
      collected_at: new Date().toISOString(),
      is_estimated: false,
      confidence: 1,
      snapshots: [
        { date: d30, monthly_sales: 100, monthly_revenue: null, product_count: 9200, avg_price: 34.5, median_price: 34 },
        { date: d0, monthly_sales: 117.89, monthly_revenue: null, product_count: 9200, avg_price: 34.5, median_price: 34 },
      ],
    };
  }

  async getTopProducts(input: { market_name: string; marketplace: string; limit?: number }): Promise<RawProductData[]> {
    void input;
    const now = new Date().toISOString();
    return Array.from({ length: Math.min(input.limit ?? 10, 10) }, (_, i) => ({      asin: `B0SENTINELC${String(i + 1).padStart(3, '0')}`,
      brand: 'SentinelBrand',
      title: `Sentinel Competitor ${i + 1}`,
      image_url: null,
      market_name: input.market_name,
      price: 30 + i,
      rating: 4.2,
      review_count: 100 + i * 20,
      bsr: 2000 + i * 300,
      estimated_sales_30d: 500 - i * 30,
      estimated_revenue_30d: (500 - i * 30) * 32,
      coupon: null,
      seller_count: 3,
      source: this.name,
      source_type: 'sentinel',
      collected_at: now,
      is_estimated: false,
      confidence: 1,
    }));
  }

  async getProductMetrics(input: { asin: string; marketplace: string }): Promise<RawProductData> {
    const top = await this.getTopProducts({ market_name: 'Sentinel', marketplace: input.marketplace, limit: 1 });
    return top[0]!;
  }

  async getKeywordMetrics(input: { keyword: string; marketplace: string }): Promise<RawKeywordData> {
    return {
      keyword: input.keyword,
      search_volume: 88888,
      trend: 17.89,
      competing_products: 1200,
      aba_click_share: 3.21,
      aba_conversion_share: 2.1,
      bid: 1.29,
      source: this.name,
      source_type: 'sentinel',
      collected_at: new Date().toISOString(),
    };
  }

  async getReviews(input: { asin: string; limit?: number }): Promise<RawReviewData[]> {
    void input;
    return [
      { asin: input.asin, text: 'SENTINEL_REVIEW_987654', rating: 4, review_date: new Date().toISOString().slice(0, 10), source: this.name },
    ];
  }

  // ===== OwnedBusinessProvider（owned_4321：4321 真实销量） =====
  async getOwnedProducts(): Promise<Array<{ sku: string; asin: string; title: string; marketplace: string }>> {
    return [{ sku: 'SENTINEL-SKU', asin: SENTINEL_OWNED_ASIN, title: 'Sentinel Owned Product', marketplace: 'US' }];
  }

  async getOrders(range: { from: string; to: string }): Promise<Array<{ asin: string; date: string; units: number; revenue: number }>> {
    void range;
    if (this.config.mode !== 'owned_4321') return [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const out: Array<{ asin: string; date: string; units: number; revenue: number }> = [];
    // 30 天窗口每日订单：总量 4321，日单量 144，均匀分布
    for (let d = 0; d < 30; d++) {
      const date = new Date(now.getTime() - d * DAY);
      const units = 144;
      out.push({ asin: SENTINEL_OWNED_ASIN, date: date.toISOString().slice(0, 10), units, revenue: units * 24.5 });
    }
    return out;
  }

  async getInventory(): Promise<Array<{ asin: string; units: number }>> {
    return [{ asin: SENTINEL_OWNED_ASIN, units: 4321 }];
  }

  async getListingStatus(): Promise<Array<{ asin: string; status: string }>> {
    return [{ asin: SENTINEL_OWNED_ASIN, status: 'ACTIVE' }];
  }

  // ===== Advertising / Cost（sentinel 无意义但接口完整） =====
  async getCampaigns(): Promise<Array<Record<string, unknown>>> {
    return [];
  }
  async getKeywords(): Promise<Array<Record<string, unknown>>> {
    return [];
  }
  async getSearchTerms(): Promise<Array<Record<string, unknown>>> {
    return [];
  }
  async getProductFees(): Promise<{ fba_fee: number; referral_fee: number; total: number }> {
    return { fba_fee: 4.2, referral_fee: 5.9, total: 10.1 };
  }
  async getSupplyChainCost(): Promise<Record<string, number>> {
    throw new ProviderError('UNKNOWN', 'sentinel: 不提供供应链成本', false);
  }
}
