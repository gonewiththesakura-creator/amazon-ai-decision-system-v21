/**
 * 原始数据接口 —— Adapter 输出层（V2 §9-10）
 * 第三方工具字段在此层被隔离，进入业务层前必须经 Normalization Engine
 */

export interface RawMarketData {
  market_name: string;
  marketplace: string;
  monthly_sales: number | null;
  monthly_revenue: number | null;
  product_count: number | null;
  seller_count: number | null;
  brand_count: number | null;
  avg_price: number | null;
  median_price: number | null;
  avg_rating: number | null;
  median_reviews: number | null;
  new_product_count: number | null;
  top10_sales_share: number | null;
  top20_sales_share: number | null;
  source: string;
  source_type: string;
  collected_at: string;
  is_estimated: boolean;
  confidence: number;
  /** 历史快照序列（用于趋势计算，按日期升序） */
  snapshots?: RawMarketSnapshot[];
}

export interface RawMarketSnapshot {
  date: string;
  monthly_sales: number | null;
  monthly_revenue: number | null;
  product_count: number | null;
  avg_price: number | null;
  median_price: number | null;
}

export interface RawProductSnapshot {
  date: string;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  bsr: number | null;
  estimated_sales: number | null;
}

export interface RawProductData {
  asin: string;
  brand: string | null;
  title: string;
  image_url: string | null;
  market_name: string | null;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  bsr: number | null;
  estimated_sales_30d: number | null;
  estimated_revenue_30d: number | null;
  coupon: number | null;
  seller_count: number | null;
  source: string;
  source_type: string;
  collected_at: string;
  is_estimated: boolean;
  confidence: number;
  snapshots?: RawProductSnapshot[];
}

export interface RawReviewData {
  asin: string;
  text: string;
  rating: number | null;
  review_date: string | null;
  source: string;
}

export interface RawKeywordData {
  keyword: string;
  search_volume: number | null;
  trend: number | null;
  competing_products: number | null;
  aba_click_share: number | null;
  aba_conversion_share: number | null;
  bid: number | null;
  source: string;
  source_type: string;
  collected_at: string;
}

export interface MarketInput {
  market_name: string;
  marketplace: string;
  keywords?: string[];
}

export interface ProductInput {
  asin: string;
  marketplace: string;
}

export interface KeywordInput {
  keyword: string;
  marketplace: string;
}

export interface MarketDataAdapter {
  readonly name: string;
  fetchMarketOverview(input: MarketInput): Promise<RawMarketData>;
  fetchMarketProducts(input: MarketInput, limit?: number): Promise<RawProductData[]>;
  fetchProductDetail(input: ProductInput): Promise<RawProductData>;
  fetchReviews(input: ProductInput, limit?: number): Promise<RawReviewData[]>;
  fetchKeywordData(input: KeywordInput): Promise<RawKeywordData>;
}
