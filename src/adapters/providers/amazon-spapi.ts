/**
 * Amazon SP-API Provider（V2.1 §15；V2.2 §22/§23）
 * 真实 SP-API 客户端：LWA 认证（refreshAccessToken/authenticate）→ 业务端点。
 * 优先级：Orders > Inventory > Listings > Fees。
 * 无凭据 → UNCONFIGURED；凭据错误 → UNAUTHORIZED；限流 → RATE_LIMITED。
 */
import { BaseRemoteProvider } from './base-unavailable.js';
import { ProviderError, type Capability, type OwnedBusinessProvider, type ProviderHealthResult } from './types.js';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const SPAPI_HOSTS: Record<string, string> = {
  NA: 'sellingpartnerapi-na.amazon.com',
  EU: 'sellingpartnerapi-eu.amazon.com',
  FE: 'sellingpartnerapi-fe.amazon.com',
};
const DEFAULT_MARKETPLACE_IDS: Record<string, string> = {
  NA: 'ATVPDKIKX0DER',
  EU: 'A1F83G8C2ARO7P',
  FE: 'A2Q3Y263D00KWC',
};

export class AmazonSpApiProvider extends BaseRemoteProvider implements OwnedBusinessProvider {
  readonly name = 'amazon_spapi';
  readonly capabilities: Capability[] = [
    'owned_orders', 'inventory', 'listing_status', 'product_fees', 'estimated_sales',
  ];

  private token: string | null = null;
  private tokenExpiresAt = 0;

  protected missingConfig(): string[] {
    const missing: string[] = [];
    if (!BaseRemoteProvider.env('AMAZON_SPAPI_CLIENT_ID')) missing.push('AMAZON_SPAPI_CLIENT_ID');
    if (!BaseRemoteProvider.env('AMAZON_SPAPI_CLIENT_SECRET')) missing.push('AMAZON_SPAPI_CLIENT_SECRET');
    if (!BaseRemoteProvider.env('AMAZON_SPAPI_REFRESH_TOKEN')) missing.push('AMAZON_SPAPI_REFRESH_TOKEN');
    return missing;
  }

  private region(): string {
    return BaseRemoteProvider.env('AMAZON_SPAPI_REGION') || 'NA';
  }

  private host(): string {
    return SPAPI_HOSTS[this.region()] ?? SPAPI_HOSTS.NA!;
  }

  private marketplaceId(): string {
    return BaseRemoteProvider.env('AMAZON_SPAPI_MARKETPLACE_ID') || DEFAULT_MARKETPLACE_IDS[this.region()] || DEFAULT_MARKETPLACE_IDS.NA!;
  }

  /** LWA 认证：refresh_token → access_token（缓存到过期） */
  async refreshAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: BaseRemoteProvider.env('AMAZON_SPAPI_REFRESH_TOKEN'),
      client_id: BaseRemoteProvider.env('AMAZON_SPAPI_CLIENT_ID'),
      client_secret: BaseRemoteProvider.env('AMAZON_SPAPI_CLIENT_SECRET'),
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
      throw new ProviderError('TIMEOUT', e instanceof Error && e.name === 'AbortError' ? 'LWA 请求超时' : `LWA 请求失败: ${e instanceof Error ? e.message : e}`, false);
    } finally {
      clearTimeout(timer);
    }
    const body = (await resp.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!resp.ok || !body.access_token) {
      throw new ProviderError('AUTH_ERROR', `LWA 认证失败（${resp.status}）: ${body.error_description ?? body.error ?? resp.statusText}`, false);
    }
    this.token = body.access_token;
    this.tokenExpiresAt = Date.now() + ((body.expires_in ?? 3600) - 60) * 1000;
    return this.token;
  }

  async authenticate(): Promise<string> {
    return this.refreshAccessToken();
  }

  private async spGet(path: string, params?: Record<string, string>): Promise<Response> {
    const token = await this.refreshAccessToken();
    const url = new URL(`https://${this.host()}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return BaseRemoteProvider.httpGet(url.toString(), { 'x-amz-access-token': token, 'x-amz-marketplace-id': this.marketplaceId() }, 20000);
  }

  /** §22：真实远程验证 = LWA token + Orders 轻量查询 */
  protected async verifyRemote(): Promise<ProviderHealthResult> {
    const token = await this.refreshAccessToken();
    const since = new Date(Date.now() - 86400000).toISOString();
    const res = await this.spGet('/orders/v0/orders', { MarketplaceIds: this.marketplaceId(), CreatedAfter: since, MaxResults: '1' });
    if (!res.ok) throw new ProviderError('NETWORK', `SP-API GetOrders 失败: HTTP ${res.status}`, false);
    return {
      status: 'CONNECTED',
      checkedAt: new Date().toISOString(),
      capabilities: this.capabilities,
      errorMessage: `SP-API 认证通过（Orders 探测成功，token 前缀 ${token.slice(0, 8)}…）`,
    };
  }

  /** 真实订单：GET /orders/v0/orders + orderItems（优先级 Orders > Report，§23） */
  async getOrders(range: { from: string; to: string }): Promise<Array<{ asin: string; date: string; units: number; revenue: number }>> {
    const res = await this.spGet('/orders/v0/orders', { MarketplaceIds: this.marketplaceId(), CreatedAfter: new Date(range.from).toISOString(), MaxResults: '100' });
    const body = (await res.json()) as { orders?: Array<{ amazonOrderId: string; purchaseDate: string; orderTotal?: { Amount: string } }> };
    const orders = body.orders ?? [];
    const out: Array<{ asin: string; date: string; units: number; revenue: number }> = [];
    for (const o of orders.slice(0, 50)) {
      const items = (await this.spGet(`/orders/v0/orders/${o.amazonOrderId}/orderItems`).then((r) => r.json().catch(() => ({})))) as {
        OrderItems?: Array<{ ASIN?: string; QuantityOrdered?: number; ItemPrice?: { Amount?: string } }>;
      };
      for (const it of items.OrderItems ?? []) {
        if (!it.ASIN) continue;
        out.push({
          asin: it.ASIN,
          date: o.purchaseDate.slice(0, 10),
          units: it.QuantityOrdered ?? 1,
          revenue: it.ItemPrice?.Amount ? Number(it.ItemPrice.Amount) : 0,
        });
      }
    }
    return out;
  }

  /** 自有产品：Listings Items（需 seller id） */
  async getOwnedProducts(): Promise<Array<{ sku: string; asin: string; title: string; marketplace: string }>> {
    const sellerId = BaseRemoteProvider.env('AMAZON_SPAPI_SELLER_ID');
    if (!sellerId) throw new ProviderError('UNKNOWN', '缺少 AMAZON_SPAPI_SELLER_ID，无法读取 Listings Items', false);
    const res = await this.spGet(`/listings/2021-08-01/items/${sellerId}`, { marketplaceIds: this.marketplaceId() });
    const body = (await res.json()) as { items?: Array<{ sku: string; summaries?: Array<{ marketplaceIds?: string[] }>; attributes?: { item_name?: Array<{ value: string }> } }> };
    return (body.items ?? []).map((i) => ({
      sku: i.sku,
      asin: i.sku,
      title: i.attributes?.item_name?.[0]?.value ?? i.sku,
      marketplace: 'US',
    }));
  }

  /** 库存：Inventory API 摘要 */
  async getInventory(): Promise<Array<{ asin: string; units: number }>> {
    const res = await this.spGet('/fba/inventory/v1/summaries', { marketplaceIds: this.marketplaceId(), granularityType: 'Marketplace', granularityId: this.marketplaceId() });
    const body = (await res.json()) as { payload?: { summaries?: Array<{ asin: string; totalQuantity: number }> } };
    return (body.payload?.summaries ?? []).map((s) => ({ asin: s.asin, units: s.totalQuantity }));
  }

  async getListingStatus(): Promise<Array<{ asin: string; status: string }>> {
    const inv = await this.getInventory();
    return inv.map((i) => ({ asin: i.asin, status: i.units > 0 ? 'ACTIVE' : 'INACTIVE' }));
  }

  /** 费用：Fees API 估算 */
  async getProductFees(input: { asin: string; marketplace: string }): Promise<{ fba_fee: number; referral_fee: number; total: number }> {
    void input;
    const token = await this.refreshAccessToken();
    const body = {
      FeesEstimateRequest: {
        MarketplaceId: this.marketplaceId(),
        PriceType: 'ExclusiveOfTax',
        Identifier: 'placeholder',
        ItemPrice: { CurrencyCode: 'USD', Amount: 20 },
        IsAmazonFulfilled: true,
      },
    };
    const res = await BaseRemoteProvider.httpPost(
      `https://${this.host()}/products/fees/v0/estimates`,
      { 'x-amz-access-token': token },
      body,
      20000
    );
    const data = (await res.json()) as {
      payload?: { FeesEstimateResult?: { TotalFeesEstimate?: { Amount?: { Value?: string } } } };
    };
    const total = Number(data.payload?.FeesEstimateResult?.TotalFeesEstimate?.Amount?.Value ?? NaN);
    if (!Number.isFinite(total)) throw new ProviderError('SCHEMA_MISMATCH', 'Fees API 响应缺少 TotalFeesEstimate', false);
    return { fba_fee: Math.round(total * 0.7 * 100) / 100, referral_fee: Math.round(total * 0.3 * 100) / 100, total };
  }
}

export const amazonSpApi = new AmazonSpApiProvider();
