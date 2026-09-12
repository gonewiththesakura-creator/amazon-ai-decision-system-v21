/**
 * Amazon SP-API Adapter（V2.1 §15）
 * 支持 authenticate / refreshToken / getCatalogItem / getListings / getInventory /
 * getOrders / getReports / getFeesEstimate。配置全部来自 .env，禁止写死 Key。
 * 本版：接口边界 + 配置探测；未授权时状态 = Unauthorized。
 */
import { BaseUnavailableProvider } from './base-unavailable.js';
import type { Capability } from './types.js';

export class AmazonSpApiProvider extends BaseUnavailableProvider {
  readonly name = 'amazon_spapi';
  readonly capabilities: Capability[] = [
    'owned_orders', 'inventory', 'listing_status', 'product_fees', 'estimated_sales',
  ];

  protected missingConfig(): string[] {
    const missing: string[] = [];
    if (!BaseUnavailableProvider.env('AMAZON_SPAPI_CLIENT_ID')) missing.push('AMAZON_SPAPI_CLIENT_ID');
    if (!BaseUnavailableProvider.env('AMAZON_SPAPI_CLIENT_SECRET')) missing.push('AMAZON_SPAPI_CLIENT_SECRET');
    if (!BaseUnavailableProvider.env('AMAZON_SPAPI_REFRESH_TOKEN')) missing.push('AMAZON_SPAPI_REFRESH_TOKEN');
    return missing;
  }
}

export const amazonSpApi = new AmazonSpApiProvider();
