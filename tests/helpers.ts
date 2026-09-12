import type { RawMarketData, RawProductData, RawMarketSnapshot, RawProductSnapshot } from '../src/adapters/types.js';

const NOW = new Date().toISOString();

export function rawMarket(overrides: Partial<RawMarketData> = {}): RawMarketData {
  return {
    market_name: 'Test Market',
    marketplace: 'US',
    monthly_sales: null,
    monthly_revenue: null,
    product_count: null,
    seller_count: null,
    brand_count: null,
    avg_price: null,
    median_price: null,
    avg_rating: null,
    median_reviews: null,
    new_product_count: null,
    top10_sales_share: null,
    top20_sales_share: null,
    source: 'test',
    source_type: 'test',
    collected_at: NOW,
    is_estimated: false,
    confidence: 1,
    ...overrides,
  };
}

export function rawProduct(overrides: Partial<RawProductData> = {}): RawProductData {
  return {
    asin: 'B0TEST0001',
    brand: null,
    title: 'Test Product',
    image_url: null,
    market_name: null,
    price: null,
    rating: null,
    review_count: null,
    bsr: null,
    estimated_sales_30d: null,
    estimated_revenue_30d: null,
    coupon: null,
    seller_count: null,
    source: 'test',
    source_type: 'test',
    collected_at: NOW,
    is_estimated: false,
    confidence: 1,
    ...overrides,
  };
}

export function rawMarketSnapshot(overrides: Partial<RawMarketSnapshot> = {}): RawMarketSnapshot {
  return {
    date: new Date().toISOString().slice(0, 10),
    monthly_sales: null,
    monthly_revenue: null,
    product_count: null,
    avg_price: null,
    median_price: null,
    ...overrides,
  };
}

export function rawProductSnapshot(overrides: Partial<RawProductSnapshot> = {}): RawProductSnapshot {
  return {
    date: new Date().toISOString().slice(0, 10),
    price: null,
    rating: null,
    review_count: null,
    bsr: null,
    estimated_sales: null,
    ...overrides,
  };
}
