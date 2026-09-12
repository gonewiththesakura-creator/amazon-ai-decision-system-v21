/**
 * Amazon Ads Provider（V2.1 §16；V2.2 §24）
 * 真实 Ads 客户端：LWA 认证 → profiles → campaigns/keywords/searchTerms。
 * 未授权保持 UNCONFIGURED/UNAUTHORIZED，绝不因 env 填齐而标 Connected。
 */
import { BaseRemoteProvider } from './base-unavailable.js';
import { ProviderError, type AdvertisingProvider, type Capability, type ProviderHealthResult } from './types.js';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const ADS_HOSTS: Record<string, string> = {
  NA: 'advertising-api.amazon.com',
  EU: 'advertising-api-eu.amazon.com',
  FE: 'advertising-api-fe.amazon.com',
};

export class AmazonAdsProvider extends BaseRemoteProvider implements AdvertisingProvider {
  readonly name = 'amazon_ads';
  readonly capabilities: Capability[] = ['ad_metrics', 'search_terms'];

  private token: string | null = null;
  private tokenExpiresAt = 0;

  protected missingConfig(): string[] {
    const missing: string[] = [];
    if (!BaseRemoteProvider.env('AMAZON_ADS_CLIENT_ID')) missing.push('AMAZON_ADS_CLIENT_ID');
    if (!BaseRemoteProvider.env('AMAZON_ADS_CLIENT_SECRET')) missing.push('AMAZON_ADS_CLIENT_SECRET');
    if (!BaseRemoteProvider.env('AMAZON_ADS_REFRESH_TOKEN')) missing.push('AMAZON_ADS_REFRESH_TOKEN');
    if (!BaseRemoteProvider.env('AMAZON_ADS_PROFILE_ID')) missing.push('AMAZON_ADS_PROFILE_ID');
    return missing;
  }

  private region(): string {
    return BaseRemoteProvider.env('AMAZON_ADS_REGION') || 'NA';
  }

  private host(): string {
    return ADS_HOSTS[this.region()] ?? ADS_HOSTS.NA!;
  }

  private profileId(): string {
    return BaseRemoteProvider.env('AMAZON_ADS_PROFILE_ID');
  }

  /** LWA 认证（Ads 使用独立 client_id/client_secret/refresh_token） */
  async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: BaseRemoteProvider.env('AMAZON_ADS_REFRESH_TOKEN'),
      client_id: BaseRemoteProvider.env('AMAZON_ADS_CLIENT_ID'),
      client_secret: BaseRemoteProvider.env('AMAZON_ADS_CLIENT_SECRET'),
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let resp: Response;
    try {
      resp = await fetch(LWA_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new ProviderError('TIMEOUT', e instanceof Error && e.name === 'AbortError' ? 'Ads LWA 请求超时' : `Ads LWA 请求失败: ${e instanceof Error ? e.message : e}`, false);
    } finally {
      clearTimeout(timer);
    }
    const body = (await resp.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!resp.ok || !body.access_token) {
      throw new ProviderError('AUTH_ERROR', `Ads LWA 认证失败（${resp.status}）: ${body.error_description ?? resp.statusText}`, false);
    }
    this.token = body.access_token;
    this.tokenExpiresAt = Date.now() + ((body.expires_in ?? 3600) - 60) * 1000;
    return this.token;
  }

  private async adsGet(path: string, params?: Record<string, string>): Promise<Response> {
    const token = await this.authenticate();
    const url = new URL(`https://${this.host()}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return BaseRemoteProvider.httpGet(
      url.toString(),
      { Authorization: `Bearer ${token}`, 'Amazon-Advertising-API-ClientId': BaseRemoteProvider.env('AMAZON_ADS_CLIENT_ID'), 'Amazon-Advertising-API-Scope': this.profileId() },
      20000
    );
  }

  /** §24：真实远程验证 = LWA + profiles 查询 */
  protected async verifyRemote(): Promise<ProviderHealthResult> {
    const token = await this.authenticate();
    const res = await this.adsGet('/v2/profiles');
    const profiles = (await res.json()) as Array<{ profileId?: number }>;
    const matched = profiles.some((p) => String(p.profileId) === this.profileId() || this.profileId() === '0');
    return {
      status: 'CONNECTED',
      checkedAt: new Date().toISOString(),
      capabilities: this.capabilities,
      errorMessage: `Ads 认证通过（profiles ${profiles.length} 个${matched ? '' : '，ProfileId 未匹配'}）`,
    };
  }

  async getCampaigns(range: { from: string; to: string }): Promise<Array<Record<string, unknown>>> {
    void range;
    const res = await this.adsGet('/v2/sp/campaigns', { stateFilter: 'ENABLED', maxResults: '100' });
    return (await res.json()) as Array<Record<string, unknown>>;
  }

  async getKeywords(range: { from: string; to: string }): Promise<Array<Record<string, unknown>>> {
    void range;
    const res = await this.adsGet('/v2/sp/keywords', { maxResults: '100' });
    return (await res.json()) as Array<Record<string, unknown>>;
  }

  async getSearchTerms(range: { from: string; to: string }): Promise<Array<Record<string, unknown>>> {
    void range;
    // 搜索词走报告（POST report → 轮询 → 下载）；基础实现直接尝试目标端点，失败如实报错
    const res = await this.adsGet('/v2/sp/searchTerms', { maxResults: '100' });
    return (await res.json()) as Array<Record<string, unknown>>;
  }
}

export const amazonAds = new AmazonAdsProvider();
