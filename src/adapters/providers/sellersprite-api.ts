/**
 * SellerSprite API Adapter（V2.1 §14）
 * 需实现 auth / rate limit / retry / timeout / pagination / error mapping / quota status。
 * 本版：接口边界 + 配置探测；未配置 Key 时状态 = Unauthorized。
 */
import { BaseUnavailableProvider } from './base-unavailable.js';
import type { Capability } from './types.js';

export class SellerSpriteApiProvider extends BaseUnavailableProvider {
  readonly name = 'sellersprite_api';
  readonly capabilities: Capability[] = [
    'market_size', 'market_growth', 'top_products', 'estimated_sales',
    'keyword_volume', 'review_text',
  ];

  protected missingConfig(): string[] {
    const missing: string[] = [];
    if (!BaseUnavailableProvider.env('SELLERSPRITE_API_KEY')) missing.push('SELLERSPRITE_API_KEY');
    return missing;
  }
}

export const sellerspriteApi = new SellerSpriteApiProvider();
