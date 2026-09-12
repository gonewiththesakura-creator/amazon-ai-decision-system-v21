/** Provider 统一注册入口（V2.1 §2；V2.2 注册 sentinel + 启动远程健康检查） */
import { providerRegistry } from './registry.js';
import { sellerspriteMcp } from './sellersprite-mcp.js';
import { sellerspriteApi } from './sellersprite-api.js';
import { sellerspriteImport } from './sellersprite-import.js';
import { amazonSpApi } from './amazon-spapi.js';
import { amazonAds } from './amazon-ads.js';
import { amazonImport } from './amazon-import.js';
import { mockProvider } from './mock-provider.js';
import { ManualProvider } from './manual-provider.js';
import { SentinelRealProvider } from './sentinel-provider.js';
import { injectPriority } from '../../config/source-priority.js';
import type { Capability } from './types.js';

/** 市场侧能力：sentinel_market（987654）优先；自有侧能力：sentinel_owned（4321）优先 */
const MARKET_CAPS: Capability[] = ['market_size', 'market_growth', 'top_products', 'estimated_sales', 'keyword_volume', 'review_text'];
const OWNED_CAPS: Capability[] = ['owned_orders', 'inventory', 'listing_status', 'ad_metrics', 'search_terms', 'product_fees', 'supply_chain'];

export function registerAllProviders(): void {
  providerRegistry.register(sellerspriteMcp);
  providerRegistry.register(sellerspriteApi);
  providerRegistry.register(sellerspriteImport);
  providerRegistry.register(amazonSpApi);
  providerRegistry.register(amazonAds);
  providerRegistry.register(amazonImport);
  providerRegistry.register(mockProvider);
  providerRegistry.register(new ManualProvider());
  // V2.2 §50：Sentinel 真实 Provider 仅测试环境注册
  //   SENTINEL_PROVIDER=market → 只注册 sentinel_market（Case A：987654）
  //   SENTINEL_PROVIDER=owned  → 只注册 sentinel_owned（§32：4321 + 17.89）
  //   SENTINEL_PROVIDER=1/all  → 两者都注册（市场能力 sentinel_market 优先，自有能力 sentinel_owned 优先）
  const sentinelFlag = (process.env.SENTINEL_PROVIDER ?? '').trim();
  const hasSentinel = (v: 'market' | 'owned') => sentinelFlag === '1' || sentinelFlag === 'all' || sentinelFlag === v;
  // 先 owned 后 market：后 unshift 的 sentinel_market 在链首，保证市场能力 987654 优先
  if (hasSentinel('owned')) {
    providerRegistry.register(new SentinelRealProvider('sentinel_owned', { mode: 'owned_4321' }));
    injectPriority('sentinel_owned', [...OWNED_CAPS, ...MARKET_CAPS]);
  }
  if (hasSentinel('market')) {
    providerRegistry.register(new SentinelRealProvider('sentinel_market', { mode: 'market_987654' }));
    injectPriority('sentinel_market', MARKET_CAPS);
  }
  providerRegistry.syncStatusToDb();
}

export { providerRegistry };
export * from './types.js';
export * from './import-engine.js';
export { amazonImport };
export { sellerspriteImport };
export { SentinelRealProvider };
