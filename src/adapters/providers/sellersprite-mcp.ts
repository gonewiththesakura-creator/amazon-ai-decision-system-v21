/**
 * SellerSprite MCP Provider（V2.1 §13；V2.2 §16-§19）
 * 真实 MCP Server 调用：connect（initialize 握手）→ 工具发现 → 工具调用 → schema 校验 → Raw 输出。
 * 工具名可通过 SELLERSPRITE_MCP_TOOL_* 覆盖（§18），默认值保留。
 * 未配置 → UNCONFIGURED；连接/调用失败 → 如实 ERROR/UNAUTHORIZED/RATE_LIMITED。
 */
import { BaseRemoteProvider } from './base-unavailable.js';
import { McpClient } from './sellersprite/mcp-client.js';
import { ProviderError, type Capability, type MarketResearchProvider, type ProviderHealthResult } from './types.js';
import type { RawKeywordData, RawMarketData, RawProductData, RawReviewData } from '../types.js';

const DEFAULT_TOOL_MAP = {
  searchMarket: 'sellersprite_search_market',
  reverseAsin: 'sellersprite_reverse_asin',
  getProductMetrics: 'sellersprite_product_metrics',
  getKeywordMetrics: 'sellersprite_keyword_metrics',
  getMarketTrend: 'sellersprite_market_trend',
  getReviews: 'sellersprite_reviews',
} as const;

function toolName(key: keyof typeof DEFAULT_TOOL_MAP): string {
  return BaseRemoteProvider.envOf(`SELLERSPRITE_MCP_TOOL_${key.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`) || DEFAULT_TOOL_MAP[key];
}

function parseMcpText(res: { content?: Array<{ type: string; text?: string }> }): unknown {
  const text = res.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new ProviderError('SCHEMA_MISMATCH', 'MCP 返回无 text 内容', false);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 宽松校验 MCP 返回并转 RawMarketData */
function rawMarketFromJson(data: Record<string, unknown>, input: { market_name: string; marketplace: string }): RawMarketData {
  const now = new Date().toISOString();
  return {
    market_name: String(data.market_name ?? data.marketName ?? input.market_name),
    marketplace: String(data.marketplace ?? input.marketplace),
    monthly_sales: toNumber(data.monthly_sales ?? data.monthlySales ?? data['月销量']),
    monthly_revenue: toNumber(data.monthly_revenue ?? data.monthlyRevenue ?? data['月销售额']),
    product_count: toNumber(data.product_count ?? data.productCount ?? data['商品数']),
    seller_count: toNumber(data.seller_count ?? data.sellerCount ?? data['卖家数']),
    brand_count: toNumber(data.brand_count ?? data.brandCount ?? data['品牌数']),
    avg_price: toNumber(data.avg_price ?? data.avgPrice ?? data['平均价格']),
    median_price: toNumber(data.median_price ?? data.medianPrice ?? data['中位价格']),
    avg_rating: toNumber(data.avg_rating ?? data.avgRating ?? data['平均评分']),
    median_reviews: toNumber(data.median_reviews ?? data.medianReviews ?? data['评论中位数']),
    new_product_count: toNumber(data.new_product_count ?? data.newProductCount ?? data['新品数']),
    top10_sales_share: toNumber(data.top10_sales_share ?? data.top10SalesShare ?? data['TOP10集中度']),
    top20_sales_share: toNumber(data.top20_sales_share ?? data.top20SalesShare ?? data['TOP20集中度']),
    source: 'sellersprite_mcp',
    source_type: 'mcp_tool',
    collected_at: now,
    is_estimated: true,
    confidence: toNumber(data.confidence) ?? 0.8,
  };
}

/** 宽松校验 MCP 返回并转 RawProductData */
function rawProductFromJson(data: Record<string, unknown>, marketName: string): RawProductData {
  const now = new Date().toISOString();
  return {
    asin: String(data.asin ?? data.ASIN ?? data['ASIN'] ?? ''),
    brand: data.brand ? String(data.brand) : null,
    title: String(data.title ?? data.product_name ?? data['商品名称'] ?? data.asin ?? ''),
    image_url: data.image_url ? String(data.image_url) : null,
    market_name: marketName,
    price: toNumber(data.price ?? data['价格']),
    rating: toNumber(data.rating ?? data['评分']),
    review_count: toNumber(data.review_count ?? data.reviewCount ?? data['评论数']),
    bsr: toNumber(data.bsr ?? data['BSR']),
    estimated_sales_30d: toNumber(data.estimated_sales_30d ?? data.estimatedSales ?? data['月销量']),
    estimated_revenue_30d: toNumber(data.estimated_revenue_30d ?? data.estimatedRevenue ?? data['月销售额']),
    coupon: toNumber(data.coupon),
    seller_count: toNumber(data.seller_count ?? data.sellerCount ?? data['卖家数']),
    source: 'sellersprite_mcp',
    source_type: 'mcp_tool',
    collected_at: now,
    is_estimated: true,
    confidence: toNumber(data.confidence) ?? 0.8,
  };
}

export class SellerSpriteMcpProvider extends BaseRemoteProvider implements MarketResearchProvider {
  readonly name = 'sellersprite_mcp';
  readonly capabilities: Capability[] = [
    'market_size', 'market_growth', 'top_products', 'estimated_sales',
    'keyword_volume', 'review_text', 'search_terms',
  ];

  private client: McpClient | null = null;

  protected missingConfig(): string[] {
    const missing: string[] = [];
    if (!BaseRemoteProvider.env('SELLERSPRITE_MCP_ENABLED')) missing.push('SELLERSPRITE_MCP_ENABLED');
    if (!BaseRemoteProvider.env('SELLERSPRITE_MCP_SERVER')) missing.push('SELLERSPRITE_MCP_SERVER');
    return missing;
  }

  /** §16：真实远程验证 = MCP initialize 握手 + 工具发现 */
  protected async verifyRemote(): Promise<ProviderHealthResult> {
    const server = BaseRemoteProvider.env('SELLERSPRITE_MCP_SERVER');
    const client = new McpClient(server);
    try {
      const handshake = await client.connect();
      this.client = client;
      const found = new Set(handshake.capabilities);
      const known = Object.values(DEFAULT_TOOL_MAP);
      const matched = known.filter((t) => found.has(t));
      return {
        status: 'CONNECTED',
        checkedAt: new Date().toISOString(),
        capabilities: matched.length > 0 ? this.capabilities : this.capabilities,
        errorMessage: `MCP 握手成功，工具 ${matched.length}/${known.length} 匹配`,
      };
    } catch (e) {
      client.close();
      this.client = null;
      const msg = e instanceof Error ? e.message : String(e);
      const code = e instanceof ProviderError ? e.code : 'NETWORK';
      return {
        status: code === 'AUTH_ERROR' ? 'UNAUTHORIZED' : code === 'RATE_LIMIT' ? 'RATE_LIMITED' : 'ERROR',
        checkedAt: new Date().toISOString(),
        capabilities: [],
        errorCode: code,
        errorMessage: `MCP 握手失败: ${msg}`,
      };
    }
  }

  private getClient(): McpClient {
    if (!this.client) {
      this.client = new McpClient(BaseRemoteProvider.env('SELLERSPRITE_MCP_SERVER'));
    }
    return this.client;
  }

  private async call(name: keyof typeof DEFAULT_TOOL_MAP, args: Record<string, unknown>): Promise<unknown> {
    if (this.getStatus() !== 'CONNECTED') throw new ProviderError('NETWORK', `SellerSprite MCP 未连接（${this.getStatusDetail()}）`, false);
    const res = await this.getClient().callTool(toolName(name), args);
    if (res.isError) throw new ProviderError('UNKNOWN', `MCP 工具 ${toolName(name)} 返回错误`, false);
    return parseMcpText(res);
  }

  async getMarketOverview(input: { market_name: string; marketplace: string; keywords?: string[] }): Promise<RawMarketData> {
    const data = (await this.call('searchMarket', { keyword: input.market_name, marketplace: input.marketplace })) as Record<string, unknown>;
    return rawMarketFromJson(data, input);
  }

  async getTopProducts(input: { market_name: string; marketplace: string; limit?: number }): Promise<RawProductData[]> {
    const data = await this.call('searchMarket', { keyword: input.market_name, marketplace: input.marketplace, limit: input.limit ?? 100 });
    const arr = Array.isArray(data) ? data : (data as { products?: unknown[] }).products ?? [];
    return arr.map((x) => rawProductFromJson(x as Record<string, unknown>, input.market_name));
  }

  async getProductMetrics(input: { asin: string; marketplace: string }): Promise<RawProductData> {
    const data = (await this.call('getProductMetrics', { asin: input.asin, marketplace: input.marketplace })) as Record<string, unknown>;
    return rawProductFromJson(data, '');
  }

  async getKeywordMetrics(input: { keyword: string; marketplace: string }): Promise<RawKeywordData> {
    const data = (await this.call('getKeywordMetrics', { keyword: input.keyword, marketplace: input.marketplace })) as Record<string, unknown>;
    return {
      keyword: input.keyword,
      search_volume: toNumber(data.search_volume ?? data.searchVolume ?? data['搜索量']),
      trend: toNumber(data.trend ?? data['趋势']),
      competing_products: toNumber(data.competing_products ?? data.competingProducts ?? data['竞品数']),
      aba_click_share: toNumber(data.aba_click_share ?? data.abaClickShare),
      aba_conversion_share: toNumber(data.aba_conversion_share ?? data.abaConversionShare),
      bid: toNumber(data.bid ?? data['竞价']),
      source: 'sellersprite_mcp',
      source_type: 'mcp_tool',
      collected_at: new Date().toISOString(),
    };
  }

  async getReviews(input: { asin: string; limit?: number }): Promise<RawReviewData[]> {
    const data = await this.call('getReviews', { asin: input.asin, limit: input.limit ?? 60 });
    const arr = Array.isArray(data) ? data : (data as { reviews?: unknown[] }).reviews ?? [];
    return arr.map((x) => {
      const r = x as Record<string, unknown>;
      return {
        asin: input.asin,
        text: String(r.text ?? r.content ?? r['评论内容'] ?? ''),
        rating: toNumber(r.rating ?? r['评分']),
        review_date: r.review_date ? String(r.review_date) : null,
        source: 'sellersprite_mcp',
      };
    });
  }
}

export const sellerspriteMcp = new SellerSpriteMcpProvider();
