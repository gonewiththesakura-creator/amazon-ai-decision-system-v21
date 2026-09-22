/**
 * SellerSprite MCP Provider（V2.1 §13；V2.2 §16-§19）
 * 真实 MCP Server 调用：connect（initialize 握手）→ 工具发现 → 工具调用 → schema 校验 → Raw 输出。
 * 工具名可通过 SELLERSPRITE_MCP_TOOL_* 覆盖（§18）；默认值为 2026-09 实测 sellersprite.com 网关真实工具名。
 * 未配置 → UNCONFIGURED；连接/调用失败 → 如实 ERROR/UNAUTHORIZED/RATE_LIMITED。
 */
import { BaseRemoteProvider } from './base-unavailable.js';
import { McpClient, RemoteMcpClient } from './sellersprite/mcp-client.js';
import { ProviderError, type Capability, type MarketResearchProvider, type ProviderHealthResult } from './types.js';
import type { RawKeywordData, RawMarketData, RawProductData, RawReviewData } from '../types.js';

/** 2026-09 实测 mcp.sellersprite.com 网关工具名（tools/list 实测，参数 schema 见工具元数据） */
const DEFAULT_TOOL_MAP = {
  searchMarket: 'market_research',
  reverseAsin: 'competitor_lookup',
  getProductMetrics: 'asin_detail',
  getKeywordMetrics: 'keyword_miner',
  getMarketTrend: 'market_product_demand_trend',
  topProducts: 'market_research_statistics',
  getReviews: 'review',
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

/** 解包卖家精灵标准返回 {code:"OK", message, data} → data */
function unwrapData(j: unknown): unknown {
  if (j && typeof j === 'object' && 'data' in (j as Record<string, unknown>) && 'code' in (j as Record<string, unknown>)) {
    return (j as { data: unknown }).data;
  }
  return j;
}

/** 当前月份 yyyyMM；offsetMonths 为负表示往前推（统计类数据常有当月滞后） */
function monthOffset(offsetMonths: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 宽松校验 MCP 返回并转 RawMarketData（market_research 类目节点字段） */
function rawMarketFromJson(data: Record<string, unknown>, input: { market_name: string; marketplace: string }): RawMarketData {
  const now = new Date().toISOString();
  return {
    market_name: String(data.nodeLabelName ?? data.market_name ?? data.marketName ?? input.market_name),
    marketplace: String(data.marketplace ?? input.marketplace),
    monthly_sales: toNumber(data.monthly_sales ?? data.monthlySales ?? data['月销量']),
    monthly_revenue: toNumber(data.monthly_revenue ?? data.monthlyRevenue ?? data['月销售额']),
    product_count: toNumber(data.product_count ?? data.totalProducts ?? data['商品数']),
    seller_count: toNumber(data.seller_count ?? data.sellers ?? data['卖家数']),
    brand_count: toNumber(data.brand_count ?? data.brands ?? data['品牌数']),
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

/** 宽松校验 MCP 返回并转 RawProductData（asin_detail / market_research_statistics 字段） */
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
    review_count: toNumber(data.review_count ?? data.reviewCount ?? data.reviews ?? data['评论数']),
    bsr: toNumber(data.bsr ?? data['BSR']),
    estimated_sales_30d: toNumber(data.estimated_sales_30d ?? data.estimatedSales ?? data.totalUnits ?? data['月销量']),
    estimated_revenue_30d: toNumber(data.estimated_revenue_30d ?? data.estimatedRevenue ?? data.totalAmount ?? data['月销售额']),
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

  private client: McpClient | RemoteMcpClient | null = null;

  /** 远程（URL+SECRET）优先；否则 stdio（SERVER） */
  private static isRemoteMode(): boolean {
    return !!BaseRemoteProvider.env('SELLERSPRITE_MCP_URL');
  }

  protected missingConfig(): string[] {
    const missing: string[] = [];
    if (!BaseRemoteProvider.env('SELLERSPRITE_MCP_ENABLED')) missing.push('SELLERSPRITE_MCP_ENABLED');
    const url = BaseRemoteProvider.env('SELLERSPRITE_MCP_URL');
    const server = BaseRemoteProvider.env('SELLERSPRITE_MCP_SERVER');
    if (!url && !server) missing.push('SELLERSPRITE_MCP_URL 或 SELLERSPRITE_MCP_SERVER');
    if (url && !BaseRemoteProvider.env('SELLERSPRITE_MCP_SECRET')) missing.push('SELLERSPRITE_MCP_SECRET');
    return missing;
  }

  /** §16：真实远程验证 = MCP initialize 握手 + 工具发现 */
  protected async verifyRemote(): Promise<ProviderHealthResult> {
    const client = this.buildClient();
    try {
      const handshake = await client.connect();
      this.client = client;
      const found = new Set(handshake.capabilities);
      const known = Object.values(DEFAULT_TOOL_MAP);
      const matched = known.filter((t) => found.has(t));
      return {
        status: 'CONNECTED',
        checkedAt: new Date().toISOString(),
        capabilities: this.capabilities,
        errorMessage: `MCP 握手成功（${this.transport()}），工具 ${matched.length}/${known.length} 匹配`,
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
        errorMessage: `MCP 握手失败（${this.transport()}）: ${msg}`,
      };
    }
  }

  private transport(): string {
    return SellerSpriteMcpProvider.isRemoteMode() ? 'remote-streamable-http' : 'stdio';
  }

  private buildClient(): McpClient | RemoteMcpClient {
    if (SellerSpriteMcpProvider.isRemoteMode()) {
      return new RemoteMcpClient(
        BaseRemoteProvider.env('SELLERSPRITE_MCP_URL'),
        BaseRemoteProvider.env('SELLERSPRITE_MCP_SECRET')
      );
    }
    return new McpClient(BaseRemoteProvider.env('SELLERSPRITE_MCP_SERVER'));
  }

  private getClient(): McpClient | RemoteMcpClient {
    if (!this.client) this.client = this.buildClient();
    return this.client;
  }

  private async call(name: keyof typeof DEFAULT_TOOL_MAP, args: Record<string, unknown>): Promise<unknown> {
    if (this.getStatus() !== 'CONNECTED') throw new ProviderError('NETWORK', `SellerSprite MCP 未连接（${this.getStatusDetail()}）`, false);
    const res = await this.getClient().callTool(toolName(name), args);
    if (res.isError) throw new ProviderError('UNKNOWN', `MCP 工具 ${toolName(name)} 返回错误`, false);
    return unwrapData(parseMcpText(res));
  }

  /** market_research → 类目节点列表；取第一条作为市场概览 */
  async getMarketOverview(input: { market_name: string; marketplace: string; keywords?: string[] }): Promise<RawMarketData> {
    const data = unwrapData(await this.call('searchMarket', { request: { marketplace: input.marketplace, departmentKeyword: input.market_name } })) as { items?: unknown[] } | null;
    const first = Array.isArray(data?.items) ? (data.items[0] as Record<string, unknown>) ?? {} : {};
    return rawMarketFromJson(first, input);
  }

  /** top 产品：market_research 拿类目节点 → market_research_statistics 头部 Listing（当月/上月），空则回退类目 top10Images→asin_detail */
  async getTopProducts(input: { market_name: string; marketplace: string; limit?: number }): Promise<RawProductData[]> {
    const cat = unwrapData(await this.call('searchMarket', { request: { marketplace: input.marketplace, departmentKeyword: input.market_name } })) as { items?: Array<Record<string, unknown>> } | null;
    const node = cat?.items?.[0];
    const nodeIdPath = node ? String(node.nodeIdPath ?? '') : '';
    const arrOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray((v as { items?: unknown })?.items) ? ((v as { items: unknown[] }).items) : Array.isArray((v as { list?: unknown })?.list) ? ((v as { list: unknown[] }).list) : []);
    if (nodeIdPath) {
      for (const month of [monthOffset(0), monthOffset(-1)]) {
        try {
          const stats = unwrapData(
            await this.call('topProducts', {
              request: {
                marketplace: input.marketplace,
                nodeIdPath,
                month,
                topN: input.limit ?? 100,
                returnFields: 'asin,title,price,totalUnits,totalAmount,rating,reviews,brand,bsr',
              },
            })
          );
          const items = arrOf(stats);
          if (items.length) return items.map((x) => rawProductFromJson(x as Record<string, unknown>, input.market_name));
        } catch {
          /* 尝试下一档 */
        }
      }
    }
    // 回退：market_research 的 top10Images（含 asin）逐个 asin_detail
    const list = (Array.isArray(node?.top10Images) ? node.top10Images : []) as Array<Record<string, unknown>>;
    const asins = list.map((x) => String(x.asin ?? '')).filter(Boolean).slice(0, input.limit ?? 100);
    const out: RawProductData[] = [];
    for (const asin of asins) {
      try {
        out.push(await this.getProductMetrics({ asin, marketplace: input.marketplace }));
      } catch {
        /* 单条失败跳过 */
      }
    }
    return out;
  }

  async getProductMetrics(input: { asin: string; marketplace: string }): Promise<RawProductData> {
    const data = (await this.call('getProductMetrics', { marketplace: input.marketplace, asin: input.asin })) as Record<string, unknown>;
    return rawProductFromJson(data, '');
  }

  async getKeywordMetrics(input: { keyword: string; marketplace: string }): Promise<RawKeywordData> {
    const data = unwrapData(await this.call('getKeywordMetrics', { request: { marketplace: input.marketplace, keyword: input.keyword } })) as { items?: unknown[] } | null;
    const k = (Array.isArray(data?.items) ? data.items[0] : null) as Record<string, unknown> | null ?? {};
    return {
      keyword: String(k.keyword ?? input.keyword),
      search_volume: toNumber(k.searches ?? k.search_volume),
      trend: toNumber(k.searches_growth ?? k.trend),
      competing_products: toNumber(k.products ?? k.competing_products),
      aba_click_share: toNumber(k.monopolyClickRate ?? k.aba_click_share),
      aba_conversion_share: toNumber(k.cvsShareRate ?? k.aba_conversion_share),
      bid: toNumber(k.bid),
      source: 'sellersprite_mcp',
      source_type: 'mcp_tool',
      collected_at: new Date().toISOString(),
    };
  }

  async getReviews(input: { asin: string; limit?: number }): Promise<RawReviewData[]> {
    const data = unwrapData(await this.call('getReviews', { marketplace: 'US', asin: input.asin, size: input.limit ?? 60 }));
    const arr = Array.isArray(data) ? data : Array.isArray((data as { items?: unknown })?.items) ? ((data as { items: unknown[] }).items) : Array.isArray((data as { list?: unknown })?.list) ? ((data as { list: unknown[] }).list) : [];
    return arr.map((x) => {
      const r = x as Record<string, unknown>;
      const ts = toNumber(r.date);
      return {
        asin: input.asin,
        text: String(r.content ?? r.text ?? r['评论内容'] ?? ''),
        rating: toNumber(r.star ?? r.rating ?? r['评分']),
        review_date: ts ? new Date(ts).toISOString().slice(0, 10) : null,
        source: 'sellersprite_mcp',
      };
    });
  }
}

export const sellerspriteMcp = new SellerSpriteMcpProvider();
