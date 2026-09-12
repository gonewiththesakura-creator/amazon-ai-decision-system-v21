/**
 * Mock Provider（V2.1 §6）——仅允许：开发 UI / 单元测试 / 集成测试 / 首次演示。
 * isMock=true，REAL 模式下 registry 永不解析到它。
 * 包装现有 MockAdapter，能力 = 全部市场研究能力（DEMO/HYBRID 用）。
 */
import { MockAdapter } from '../mock/mock-adapter.js';
import type { Capability, MarketResearchProvider, ProviderBase, ProviderConnectionStatus } from './types.js';

export class MockProvider implements ProviderBase, MarketResearchProvider {
  readonly name = 'mock';
  readonly isMock = true;
  readonly capabilities: Capability[] = [
    'market_size', 'market_growth', 'top_products', 'estimated_sales',
    'keyword_volume', 'review_text', 'owned_orders', 'inventory',
    'listing_status', 'ad_metrics', 'search_terms', 'product_fees', 'supply_chain',
  ];

  private adapter = new MockAdapter();

  getStatus(): ProviderConnectionStatus {
    return 'Connected';
  }

  getStatusDetail(): string {
    return 'Mock 数据（仅限开发/测试/演示，严禁在 REAL 模式使用）';
  }

  healthCheck(): Capability[] {
    return this.capabilities;
  }

  // MarketResearchProvider 实现 → 转发 MockAdapter
  async getMarketOverview(input: { market_name: string; marketplace: string; keywords?: string[] }) {
    return this.adapter.fetchMarketOverview(input);
  }
  async getTopProducts(input: { market_name: string; marketplace: string; limit?: number }) {
    return this.adapter.fetchMarketProducts({ market_name: input.market_name, marketplace: input.marketplace }, input.limit ?? 100);
  }
  async getProductMetrics(input: { asin: string; marketplace: string }) {
    return this.adapter.fetchProductDetail(input);
  }
  async getKeywordMetrics(input: { keyword: string; marketplace: string }) {
    return this.adapter.fetchKeywordData(input);
  }
  async getReviews(input: { asin: string; limit?: number }) {
    return this.adapter.fetchReviews({ asin: input.asin, marketplace: 'US' }, input.limit ?? 60);
  }
}

export const mockProvider = new MockProvider();
