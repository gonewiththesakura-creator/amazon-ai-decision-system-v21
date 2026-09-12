/**
 * Mock Provider（V2.1 §6；V2.2 §33）——仅允许：开发 UI / 单元测试 / 集成测试 / 首次演示。
 * isMock=true，REAL 模式下 registry 永不解析到它；getAdapter('mock') 已标记 @deprecated。
 * V2.2：补齐 OwnedBusiness / Advertising / Cost 能力接口（能力解析路径下可被调用），
 * 并实现 healthCheckRemote（仅 DEMO/测试环境视为 CONNECTED）。
 */
import { MockAdapter, OWNED_SKU_PROFILES, ownedToRaw } from '../mock/mock-adapter.js';
import type {
  Capability,
  MarketResearchProvider,
  OwnedBusinessProvider,
  AdvertisingProvider,
  CostProvider,
  ProviderBase,
  ProviderConnectionStatus,
  ProviderHealthResult,
} from './types.js';

const DAY = 86400000;

export class MockProvider implements ProviderBase, MarketResearchProvider, OwnedBusinessProvider, AdvertisingProvider, CostProvider {
  readonly name = 'mock';
  readonly isMock = true;
  readonly capabilities: Capability[] = [
    'market_size', 'market_growth', 'top_products', 'estimated_sales',
    'keyword_volume', 'review_text', 'owned_orders', 'inventory',
    'listing_status', 'ad_metrics', 'search_terms', 'product_fees', 'supply_chain',
  ];

  private adapter = new MockAdapter();
  private lastHealth: ProviderHealthResult | null = null;

  getLastHealth(): ProviderHealthResult | null {
    return this.lastHealth;
  }

  getStatus(): ProviderConnectionStatus {
    return 'CONNECTED';
  }

  getStatusDetail(): string {
    return 'Mock 数据（仅限开发/测试/演示，严禁在 REAL 模式使用）';
  }

  healthCheck(): Capability[] {
    return this.capabilities;
  }

  /** Mock 的远程检查：仅测试/开发环境通过（REAL 模式由 registry 拦截 isMock，永不参与解析） */
  async healthCheckRemote(): Promise<ProviderHealthResult> {
    const h: ProviderHealthResult = {
      status: 'CONNECTED',
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      capabilities: this.capabilities,
      errorCode: undefined,
      errorMessage: 'Mock Provider（仅开发/测试/演示）',
    };
    this.lastHealth = h;
    return h;
  }

  // ===== MarketResearchProvider =====
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

  // ===== OwnedBusinessProvider（DEMO：由 SKU 画像派生 90 天订单序列） =====
  async getOwnedProducts(): Promise<Array<{ sku: string; asin: string; title: string; marketplace: string }>> {
    return OWNED_SKU_PROFILES.map((p) => ({ sku: p.sku, asin: p.asin, title: p.internalName, marketplace: 'US' }));
  }

  /** 90 天日订单（date 距今天 0..89；units 按 30D 增速递增，供 SKU 快照聚合计算增速） */
  async getOrders(range: { from: string; to: string }): Promise<Array<{ asin: string; date: string; units: number; revenue: number }>> {
    void range;
    const out: Array<{ asin: string; date: string; units: number; revenue: number }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const p of OWNED_SKU_PROFILES) {
      const raw = ownedToRaw(p);
      const latest = raw.snapshots?.[raw.snapshots.length - 1];
      const sales30d = latest?.estimated_sales ?? p.sales30d;
      // SKU 30D 增速（g）≈ 所属市场增速 + 相对表现
      const skuG = Math.max(0.05, (p.relative30d ?? 0) + 12.1);
      // 近30天窗口累计 = sales30d：Σ_{d=0}^{29} base*(1+g)^(d/30) ≈ sales30d → base
      const g = skuG / 100;
      const factorSum = g === 0 ? 30 : ((Math.pow(1 + g, 1) - 1) / g) * 30;
      const base = sales30d / factorSum;
      const price = latest?.price ?? p.price;
      for (let d = 0; d < 90; d++) {
        const date = new Date(today.getTime() - d * DAY);
        // 浮点 units（保留 2 位小数）：增速 0.8%/月级别在 Math.round 后会消失，导致 30D 窗口差异为 0。
        // d=0（今天）最大，d=89（最早）最小 —— 销量随时间增长。
        const units = Math.max(0.5, Math.round(base * Math.pow(1 + g, (89 - d) / 30) * 100) / 100);
        out.push({ asin: p.asin, date: date.toISOString().slice(0, 10), units, revenue: Math.round(units * price * 100) / 100 });
      }
    }
    return out;
  }

  async getInventory(): Promise<Array<{ asin: string; units: number }>> {
    return OWNED_SKU_PROFILES.map((p) => ({ asin: p.asin, units: 500 + Math.floor(Math.random() * 1000) }));
  }

  async getListingStatus(): Promise<Array<{ asin: string; status: string }>> {
    return OWNED_SKU_PROFILES.map((p) => ({ asin: p.asin, status: 'ACTIVE' }));
  }

  // ===== AdvertisingProvider =====
  async getCampaigns(): Promise<Array<Record<string, unknown>>> {
    return OWNED_SKU_PROFILES.map((p) => ({ asin: p.asin, campaign_name: `${p.sku} campaign`, status: 'ENABLED' }));
  }
  async getKeywords(): Promise<Array<Record<string, unknown>>> {
    return [];
  }
  async getSearchTerms(): Promise<Array<Record<string, unknown>>> {
    return [];
  }

  // ===== CostProvider =====
  async getProductFees(input: { asin: string; marketplace: string }): Promise<{ fba_fee: number; referral_fee: number; total: number }> {
    void input;
    return { fba_fee: 4.2, referral_fee: 5.9, total: 10.1 };
  }
  async getSupplyChainCost(input: { sku: string }): Promise<Record<string, number>> {
    void input;
    return { unit_cost: 4.5, shipping: 1.2, total: 5.7 };
  }
}

export const mockProvider = new MockProvider();
