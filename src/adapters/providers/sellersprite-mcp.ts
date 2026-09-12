/**
 * SellerSprite MCP Adapter（V2.1 §13）
 * MCP 工具名称通过 config 映射，业务层不依赖具体 tool name。
 * 未配置 MCP 服务时状态 = Unauthorized，能力收缩为空。
 */
import { BaseUnavailableProvider } from './base-unavailable.js';
import type { Capability } from './types.js';

const MCP_TOOL_MAP: Record<string, string> = {
  searchMarket: 'sellersprite_search_market',
  reverseAsin: 'sellersprite_reverse_asin',
  getProductMetrics: 'sellersprite_product_metrics',
  getKeywordMetrics: 'sellersprite_keyword_metrics',
  getMarketTrend: 'sellersprite_market_trend',
};

export class SellerSpriteMcpProvider extends BaseUnavailableProvider {
  readonly name = 'sellersprite_mcp';
  readonly capabilities: Capability[] = [
    'market_size', 'market_growth', 'top_products', 'estimated_sales',
    'keyword_volume', 'review_text', 'search_terms',
  ];

  readonly toolMap = MCP_TOOL_MAP;

  protected missingConfig(): string[] {
    const missing: string[] = [];
    if (!BaseUnavailableProvider.env('SELLERSPRITE_MCP_ENABLED')) missing.push('SELLERSPRITE_MCP_ENABLED');
    if (!BaseUnavailableProvider.env('SELLERSPRITE_MCP_SERVER')) missing.push('SELLERSPRITE_MCP_SERVER');
    return missing;
  }
}

export const sellerspriteMcp = new SellerSpriteMcpProvider();
