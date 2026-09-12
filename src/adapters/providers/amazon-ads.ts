/**
 * Amazon Ads Adapter（V2.1 §16）
 * 预留 profileId / region / accessToken / refreshToken / clientId / clientSecret。
 * 支持 campaigns / keywords / searchTerms / performance。
 * 本版：接口边界 + 配置探测；未授权时状态 = Unauthorized。
 */
import { BaseUnavailableProvider } from './base-unavailable.js';
import type { Capability } from './types.js';

export class AmazonAdsProvider extends BaseUnavailableProvider {
  readonly name = 'amazon_ads';
  readonly capabilities: Capability[] = ['ad_metrics', 'search_terms'];

  protected missingConfig(): string[] {
    const missing: string[] = [];
    if (!BaseUnavailableProvider.env('AMAZON_ADS_CLIENT_ID')) missing.push('AMAZON_ADS_CLIENT_ID');
    if (!BaseUnavailableProvider.env('AMAZON_ADS_CLIENT_SECRET')) missing.push('AMAZON_ADS_CLIENT_SECRET');
    if (!BaseUnavailableProvider.env('AMAZON_ADS_REFRESH_TOKEN')) missing.push('AMAZON_ADS_REFRESH_TOKEN');
    if (!BaseUnavailableProvider.env('AMAZON_ADS_PROFILE_ID')) missing.push('AMAZON_ADS_PROFILE_ID');
    return missing;
  }
}

export const amazonAds = new AmazonAdsProvider();
