/** 业务能力接口（V2.1 §3）：按业务能力定义，多个 Provider 服务同一能力 */
import type { RawKeywordData, RawMarketData, RawProductData, RawReviewData } from '../types.js';

/** Provider 连接状态机（V2.2 §13/§14）：Connected 只能由真实 healthCheckRemote 达成 */
export type ProviderConnectionStatus =
  | 'UNCONFIGURED'   // 未配置（缺 env / 无数据）
  | 'CONFIGURED'     // 配置齐备，尚未完成远程验证
  | 'CONNECTING'     // 正在远程验证中
  | 'CONNECTED'      // 远程 healthCheck 成功（唯一可信状态）
  | 'DEGRADED'       // 可用但有降级（配额低/部分能力不可用）
  | 'RATE_LIMITED'   // 限流
  | 'UNAUTHORIZED'   // 认证失败/授权未完成
  | 'ERROR';         // 其他错误

/** Provider Health Result（V2.2 §15） */
export interface ProviderHealthResult {
  status: ProviderConnectionStatus;
  checkedAt: string;
  latencyMs?: number;
  capabilities: Capability[];
  errorCode?: string;
  errorMessage?: string;
}

/** 统一错误码（V2.2 §38） */
export type ProviderErrorCode =
  | 'AUTH_ERROR' | 'RATE_LIMIT' | 'TIMEOUT' | 'NETWORK'
  | 'SCHEMA_MISMATCH' | 'PERMISSION_DENIED' | 'QUOTA_EXCEEDED' | 'UNKNOWN';

export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, message: string, public retryable = false) {
    super(message);
    this.name = 'ProviderError';
  }
}

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

/** Provider 基类约定（V2.2：Connected 由 healthCheckRemote 达成，非 env 填齐） */
export interface ProviderBase {
  readonly name: string;
  readonly isMock: boolean;
  readonly capabilities: Capability[];
  /** 当前状态（未远程验证前不得为 CONNECTED） */
  getStatus(): ProviderConnectionStatus;
  getStatusDetail(): string;
  /** 同步可用能力（= CONNECTED 时返回能力集） */
  healthCheck(): Capability[];
  /** 真实远程健康检查（唯一能把状态推到 CONNECTED 的路径） */
  healthCheckRemote(): Promise<ProviderHealthResult>;
  /** 最近一次远程健康检查结果（无则为 null） */
  getLastHealth(): ProviderHealthResult | null;
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
