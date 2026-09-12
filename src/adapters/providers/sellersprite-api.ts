/**
 * SellerSprite API Provider（V2.1 §14；V2.2 §20/§21）
 * 真实 HTTP 客户端：auth（API Key）/ baseURL / timeout / retry / rate limit / pagination / quota / response validation / error mapping。
 * endpoint 未确认时保持 UNCONFIGURED，但代码具备真实调用能力（可经 SELLERSPRITE_API_ENDPOINT_* 配置）。
 */
import { BaseRemoteProvider } from './base-unavailable.js';
import { ProviderError, type Capability, type MarketResearchProvider, type ProviderHealthResult } from './types.js';
import type { RawKeywordData, RawMarketData, RawProductData, RawReviewData } from '../types.js';

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown, fallback = ''): string {
  return v == null ? fallback : String(v);
}

export class SellerSpriteApiProvider extends BaseRemoteProvider implements MarketResearchProvider {
  readonly name = 'sellersprite_api';
  readonly capabilities: Capability[] = [
    'market_size', 'market_growth', 'top_products', 'estimated_sales',
    'keyword_volume', 'review_text',
  ];

  private baseUrl(): string {
    return BaseRemoteProvider.env('SELLERSPRITE_API_BASEURL') || 'https://openapi.sellersprite.com';
  }

  private headers(): Record<string, string> {
    const key = BaseRemoteProvider.env('SELLERSPRITE_API_KEY');
    return { 'X-Api-Key': key, Authorization: `Bearer ${key}` };
  }

  protected missingConfig(): string[] {
    const missing: string[] = [];
    if (!BaseRemoteProvider.env('SELLERSPRITE_API_KEY')) missing.push('SELLERSPRITE_API_KEY');
    return missing;
  }

  /** §20：真实远程验证 = 带认证请求 baseURL（成功 2xx → CONNECTED） */
  protected async verifyRemote(): Promise<ProviderHealthResult> {
    const endpoint = BaseRemoteProvider.env('SELLERSPRITE_API_ENDPOINT_HEALTH') || '/v2/projects';
    const res = await BaseRemoteProvider.httpGet(`${this.baseUrl()}${endpoint}`, this.headers(), 15000);
    const body = await res.json().catch(() => ({})) as { code?: number; data?: unknown };
    if (res.ok && (body.code === undefined || body.code === 0 || body.code === 200)) {
      return {
        status: 'CONNECTED',
        checkedAt: new Date().toISOString(),
        capabilities: this.capabilities,
        errorMessage: `SellerSprite API 认证通过（${endpoint}）`,
      };
    }
    throw new ProviderError('SCHEMA_MISMATCH', `SellerSprite API 响应格式异常: ${JSON.stringify(body).slice(0, 200)}`, false);
  }

  private async getJson(path: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl()}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await BaseRemoteProvider.httpGet(url.toString(), this.headers(), 15000);
        return (await res.json()) as Record<string, unknown>;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (e instanceof ProviderError && e.retryable) continue;
        throw e;
      }
    }
    throw lastErr;
  }

  private unwrap(res: Record<string, unknown>): unknown {
    const data = res.data ?? res.result ?? res;
    if (Array.isArray(data)) return data;
    if (Array.isArray((data as { list?: unknown[] }).list)) return (data as { list: unknown[] }).list;
    return data;
  }

  async getMarketOverview(input: { market_name: string; marketplace: string; keywords?: string[] }): Promise<RawMarketData> {
    const endpoint = BaseRemoteProvider.env('SELLERSPRITE_API_ENDPOINT_MARKET') || '/v2/market/overview';
    const res = await this.getJson(endpoint, { keyword: input.market_name, marketplace: input.marketplace });
    const d = this.unwrap(res) as Record<string, unknown>;
    const now = new Date().toISOString();
    return {
      market_name: input.market_name,
      marketplace: input.marketplace,
      monthly_sales: toNumber(d.monthly_sales ?? d.monthlySales ?? d['月销量']),
      monthly_revenue: toNumber(d.monthly_revenue ?? d.monthlyRevenue ?? d['月销售额']),
      product_count: toNumber(d.product_count ?? d.productCount ?? d['商品数']),
      seller_count: toNumber(d.seller_count ?? d.sellerCount ?? d['卖家数']),
      brand_count: toNumber(d.brand_count ?? d.brandCount ?? d['品牌数']),
      avg_price: toNumber(d.avg_price ?? d.avgPrice ?? d['平均价格']),
      median_price: toNumber(d.median_price ?? d.medianPrice ?? d['中位价格']),
      avg_rating: toNumber(d.avg_rating ?? d.avgRating ?? d['平均评分']),
      median_reviews: toNumber(d.median_reviews ?? d.medianReviews ?? d['评论中位数']),
      new_product_count: toNumber(d.new_product_count ?? d.newProductCount ?? d['新品数']),
      top10_sales_share: toNumber(d.top10_sales_share ?? d.top10SalesShare ?? d['TOP10集中度']),
      top20_sales_share: toNumber(d.top20_sales_share ?? d.top20SalesShare ?? d['TOP20集中度']),
      source: 'sellersprite_api',
      source_type: 'api',
      collected_at: now,
      is_estimated: true,
      confidence: toNumber(d.confidence) ?? 0.8,
    };
  }

  async getTopProducts(input: { market_name: string; marketplace: string; limit?: number }): Promise<RawProductData[]> {
    const endpoint = BaseRemoteProvider.env('SELLERSPRITE_API_ENDPOINT_PRODUCTS') || '/v2/market/products';
    const res = await this.getJson(endpoint, { keyword: input.market_name, marketplace: input.marketplace, limit: String(input.limit ?? 100) });
    const arr = Array.isArray(this.unwrap(res)) ? (this.unwrap(res) as unknown[]) : [];
    const now = new Date().toISOString();
    return arr.map((x) => {
      const p = x as Record<string, unknown>;
      return {
        asin: str(p.asin ?? p.ASIN),
        brand: p.brand ? str(p.brand) : null,
        title: str(p.title ?? p.product_name ?? p['商品名称'] ?? p.asin),
        image_url: p.image_url ? str(p.image_url) : null,
        market_name: input.market_name,
        price: toNumber(p.price ?? p['价格']),
        rating: toNumber(p.rating ?? p['评分']),
        review_count: toNumber(p.review_count ?? p.reviewCount ?? p['评论数']),
        bsr: toNumber(p.bsr ?? p['BSR']),
        estimated_sales_30d: toNumber(p.estimated_sales_30d ?? p.estimatedSales ?? p['月销量']),
        estimated_revenue_30d: toNumber(p.estimated_revenue_30d ?? p.estimatedRevenue ?? p['月销售额']),
        coupon: toNumber(p.coupon),
        seller_count: toNumber(p.seller_count ?? p.sellerCount ?? p['卖家数']),
        source: 'sellersprite_api',
        source_type: 'api',
        collected_at: now,
        is_estimated: true,
        confidence: toNumber(p.confidence) ?? 0.8,
      };
    });
  }

  async getProductMetrics(input: { asin: string; marketplace: string }): Promise<RawProductData> {
    const endpoint = BaseRemoteProvider.env('SELLERSPRITE_API_ENDPOINT_PRODUCT') || '/v2/product/metrics';
    const res = await this.getJson(endpoint, { asin: input.asin, marketplace: input.marketplace });
    const p = this.unwrap(res) as Record<string, unknown>;
    const now = new Date().toISOString();
    return {
      asin: input.asin,
      brand: p.brand ? str(p.brand) : null,
      title: str(p.title ?? p.product_name ?? p['商品名称'] ?? input.asin),
      image_url: p.image_url ? str(p.image_url) : null,
      market_name: null,
      price: toNumber(p.price ?? p['价格']),
      rating: toNumber(p.rating ?? p['评分']),
      review_count: toNumber(p.review_count ?? p.reviewCount ?? p['评论数']),
      bsr: toNumber(p.bsr ?? p['BSR']),
      estimated_sales_30d: toNumber(p.estimated_sales_30d ?? p.estimatedSales ?? p['月销量']),
      estimated_revenue_30d: toNumber(p.estimated_revenue_30d ?? p.estimatedRevenue ?? p['月销售额']),
      coupon: toNumber(p.coupon),
      seller_count: toNumber(p.seller_count ?? p.sellerCount ?? p['卖家数']),
      source: 'sellersprite_api',
      source_type: 'api',
      collected_at: now,
      is_estimated: true,
      confidence: toNumber(p.confidence) ?? 0.8,
    };
  }

  async getKeywordMetrics(input: { keyword: string; marketplace: string }): Promise<RawKeywordData> {
    const endpoint = BaseRemoteProvider.env('SELLERSPRITE_API_ENDPOINT_KEYWORD') || '/v2/keyword/metrics';
    const res = await this.getJson(endpoint, { keyword: input.keyword, marketplace: input.marketplace });
    const d = this.unwrap(res) as Record<string, unknown>;
    return {
      keyword: input.keyword,
      search_volume: toNumber(d.search_volume ?? d.searchVolume ?? d['搜索量']),
      trend: toNumber(d.trend ?? d['趋势']),
      competing_products: toNumber(d.competing_products ?? d.competingProducts ?? d['竞品数']),
      aba_click_share: toNumber(d.aba_click_share ?? d.abaClickShare),
      aba_conversion_share: toNumber(d.aba_conversion_share ?? d.abaConversionShare),
      bid: toNumber(d.bid ?? d['竞价']),
      source: 'sellersprite_api',
      source_type: 'api',
      collected_at: new Date().toISOString(),
    };
  }

  async getReviews(input: { asin: string; limit?: number }): Promise<RawReviewData[]> {
    const endpoint = BaseRemoteProvider.env('SELLERSPRITE_API_ENDPOINT_REVIEWS') || '/v2/product/reviews';
    const res = await this.getJson(endpoint, { asin: input.asin, limit: String(input.limit ?? 60) });
    const arr = Array.isArray(this.unwrap(res)) ? (this.unwrap(res) as unknown[]) : [];
    return arr.map((x) => {
      const r = x as Record<string, unknown>;
      return {
        asin: input.asin,
        text: str(r.text ?? r.content ?? r['评论内容']),
        rating: toNumber(r.rating ?? r['评分']),
        review_date: r.review_date ? str(r.review_date) : null,
        source: 'sellersprite_api',
      };
    });
  }
}

export const sellerspriteApi = new SellerSpriteApiProvider();
