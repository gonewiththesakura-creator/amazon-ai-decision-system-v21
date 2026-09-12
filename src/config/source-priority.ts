/** Source Priority（V2.1 §20）：每类业务数据的 Provider 优先级链 */
import type { Capability } from '../adapters/providers/types.js';

export const SOURCE_PRIORITY: Record<string, string[]> = {
  owned_sales: ['amazon_spapi', 'amazon_import', 'sellersprite_mcp', 'sellersprite_api', 'manual', 'mock'],
  owned_orders: ['amazon_spapi', 'amazon_import', 'mock'],
  inventory: ['amazon_spapi', 'amazon_import', 'mock'],
  listing_status: ['amazon_spapi', 'amazon_import', 'mock'],
  competitor_sales: ['sellersprite_mcp', 'sellersprite_api', 'sellersprite_import', 'mock'],
  market_size: ['sellersprite_mcp', 'sellersprite_api', 'sellersprite_import', 'mock'],
  market_growth: ['sellersprite_mcp', 'sellersprite_api', 'sellersprite_import', 'mock'],
  top_products: ['sellersprite_mcp', 'sellersprite_api', 'sellersprite_import', 'mock'],
  keyword_volume: ['sellersprite_mcp', 'sellersprite_api', 'sellersprite_import', 'mock'],
  review_text: ['sellersprite_mcp', 'sellersprite_import', 'manual', 'mock'],
  ad_metrics: ['amazon_ads', 'amazon_import', 'mock'],
  search_terms: ['amazon_ads', 'sellersprite_mcp', 'amazon_import', 'mock'],
  product_fees: ['amazon_spapi', 'amazon_import', 'manual', 'mock'],
  supply_chain: ['manual', 'mock'],
};

/** capability → 任务类型映射（Data Plan 用） */
export const JOB_TYPE_REQUIRED_CAPABILITIES: Record<string, { required: Capability[]; optional: Capability[] }> = {
  existing_market: {
    required: ['market_size', 'market_growth', 'top_products'],
    optional: ['keyword_volume', 'review_text', 'ad_metrics'],
  },
  owned_product: {
    required: ['market_growth', 'top_products', 'owned_orders'],
    optional: ['keyword_volume', 'review_text', 'ad_metrics', 'inventory'],
  },
  adjacent_product: {
    required: ['market_size', 'market_growth', 'top_products'],
    optional: ['keyword_volume', 'review_text', 'estimated_sales'],
  },
  new_opportunity: {
    required: ['market_size', 'market_growth'],
    optional: ['top_products', 'keyword_volume', 'review_text', 'estimated_sales', 'supply_chain'],
  },
};
