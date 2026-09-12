/** 业务能力接口（V2.1 §3）：按业务能力定义，多个 Provider 服务同一能力 */
import type { RawKeywordData, RawMarketData, RawProductData, RawReviewData } from '../types.js';

export type ProviderConnectionStatus = 'Connected' | 'Unauthorized' | 'Rate Limited' | 'Unavailable';

export type Capability =
  | 'market_size' | 'market_growth' | 'top_products' | 'estimated_sales'
  | 'keyword_volume' | 'review_text' | 'owned_orders' | 'inventory'
  | 'listing_status' | 'ad_metrics' | 'search_terms' | 'product_fees' | 'supply_chain';

/** 市场研究能力 */
export interface MarketResearchProvider {
  getMarketOverview(input: { market_name: string; marketplace: string; keywords?: string[] }): Promise<RawMarketData>;
  getTopProducts(input: { market_name: string; marketplace: string; limit?: number }): Promise<RawProductData[]>;
  getProductMetrics(input: { asin: string; marketplace: string }): Promise<RawProductData>;
  getKeywordMetrics(input: { keyword: string; marketplace: string }): Promise<RawKeywordData>;
  getReviews(input: { asin: string; limit?: number }): Promise<RawReviewData[]>;
}

/** 自有业务能力 */
export interface OwnedBusinessProvider {
  getOwnedProducts(): Promise<Array<{ sku: string; asin: string; title: string; marketplace: string }>>;
  getOrders(range: { from: string; to: string }): Promise<Array<{ asin: string; date: string; units: number; revenue: number }>>;
  getInventory(): Promise<Array<{ asin: string; units: number }>>;
  getListingStatus(): Promise<Array<{ asin: string; status: string }>>;
}

/** 广告能力（本版接口边界） */
export interface AdvertisingProvider {
  getCampaigns(range: { from: string; to: string }): Promise<Array<Record<string, unknown>>>;
  getKeywords(range: { from: string; to: string }): Promise<Array<Record<string, unknown>>>;
  getSearchTerms(range: { from: string; to: string }): Promise<Array<Record<string, unknown>>>;
}

/** 成本能力 */
export interface CostProvider {
  getProductFees(input: { asin: string; marketplace: string }): Promise<{ fba_fee: number; referral_fee: number; total: number }>;
  getSupplyChainCost(input: { sku: string }): Promise<Record<string, number>>;
}

/** Provider 基类约定 */
export interface ProviderBase {
  readonly name: string;
  readonly isMock: boolean;
  readonly capabilities: Capability[];
  getStatus(): ProviderConnectionStatus;
  getStatusDetail(): string;
  healthCheck(): Capability[];
}

/** Provider 未授权/不可用时抛出（REAL 模式不 fallback 到 Mock） */
export class ProviderUnavailableError extends Error {
  constructor(public provider: string, public status: ProviderConnectionStatus, message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** 业务所需能力缺失（→ needs_data） */
export class NeedsDataError extends Error {
  constructor(public missingCapabilities: Capability[], public missingProviders: string[], message: string) {
    super(message);
    this.name = 'NeedsDataError';
  }
}
