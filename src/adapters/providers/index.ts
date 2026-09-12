/** Provider 统一注册入口（V2.1 §2） */
import { providerRegistry } from './registry.js';
import { sellerspriteMcp } from './sellersprite-mcp.js';
import { sellerspriteApi } from './sellersprite-api.js';
import { sellerspriteImport } from './sellersprite-import.js';
import { amazonSpApi } from './amazon-spapi.js';
import { amazonAds } from './amazon-ads.js';
import { amazonImport } from './amazon-import.js';
import { mockProvider } from './mock-provider.js';
import { ManualProvider } from './manual-provider.js';

export function registerAllProviders(): void {
  providerRegistry.register(sellerspriteMcp);
  providerRegistry.register(sellerspriteApi);
  providerRegistry.register(sellerspriteImport);
  providerRegistry.register(amazonSpApi);
  providerRegistry.register(amazonAds);
  providerRegistry.register(amazonImport);
  providerRegistry.register(mockProvider);
  providerRegistry.register(new ManualProvider());
  providerRegistry.syncStatusToDb();
}

export { providerRegistry };
export * from './types.js';
export * from './import-engine.js';
export { amazonImport };
export { sellerspriteImport };
