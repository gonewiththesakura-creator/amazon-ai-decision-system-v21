/**
 * SellerSpriteImportAdapter —— CSV 导入适配器
 * 支持 SellerSprite 常见导出列名（中英文）的字段映射
 * 解析为 Raw 结构后，同样必须经过 Normalization Engine
 */
import type { MarketDataAdapter, MarketInput, ProductInput, RawMarketData, RawProductData, RawReviewData, KeywordInput, RawKeywordData } from '../types.js';

/** 简易 CSV 解析（支持引号包裹、逗号、换行） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  asin: 'asin', 'ASIN': 'asin', '商品ASIN': 'asin', 'asin1': 'asin',
  brand: 'brand', '品牌': 'brand',
  title: 'title', '标题': 'title', '商品标题': 'title',
  price: 'price', '价格': 'price', '售价': 'price', '现价': 'price',
  rating: 'rating', '评分': 'rating', '星级': 'rating',
  reviews: 'review_count', 'review_count': 'review_count', '评论数': 'review_count', '评论数量': 'review_count',
  bsr: 'bsr', 'BSR': 'bsr', '大类排名': 'bsr', '排名': 'bsr',
  sales: 'estimated_sales_30d', 'estimated_sales_30d': 'estimated_sales_30d', '月销量': 'estimated_sales_30d', '销量': 'estimated_sales_30d', '30天销量': 'estimated_sales_30d',
  revenue: 'estimated_revenue_30d', 'estimated_revenue_30d': 'estimated_revenue_30d', '月销售额': 'estimated_revenue_30d', '销售额': 'estimated_revenue_30d',
  coupon: 'coupon', '优惠券': 'coupon', 'coupons': 'coupon',
  seller_count: 'seller_count', '卖家数': 'seller_count', '卖家数量': 'seller_count',
  market: 'market_name', 'market_name': 'market_name', '类目': 'market_name', '细分市场': 'market_name', '市场': 'market_name',
  image_url: 'image_url', '主图': 'image_url', '图片': 'image_url',
};

function mapRow(header: string[], row: string[], source: string): RawProductData | null {
  const obj: Record<string, string> = {};
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[h.trim()] ?? HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim();
    obj[key] = row[i]?.trim() ?? '';
  });
  const asin = obj['asin'];
  if (!asin) return null;
  const num = (v: string | undefined): number | null => {
    if (v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[$,€£¥]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  return {
    asin,
    brand: obj['brand'] || null,
    title: obj['title'] || asin,
    image_url: obj['image_url'] || null,
    market_name: obj['market_name'] || null,
    price: num(obj['price']),
    rating: num(obj['rating']),
    review_count: num(obj['review_count']),
    bsr: num(obj['bsr']),
    estimated_sales_30d: num(obj['estimated_sales_30d']),
    estimated_revenue_30d: num(obj['estimated_revenue_30d']),
    coupon: num(obj['coupon']),
    seller_count: num(obj['seller_count']),
    source,
    source_type: 'import',
    collected_at: new Date().toISOString(),
    is_estimated: true,
    confidence: 0.85,
  };
}

export class CsvImportAdapter implements MarketDataAdapter {
  readonly name = 'sellersprite-import';

  constructor(private csvText: string, private sourceLabel = 'SellerSprite(Import)') {}

  /** 将 CSV 文本解析为 RawProductData 列表（供导入使用） */
  parseProducts(): RawProductData[] {
    const rows = parseCsv(this.csvText);
    if (rows.length < 2) return [];
    const header = rows[0]!;
    return rows
      .slice(1)
      .map((r) => mapRow(header, r, this.sourceLabel))
      .filter((p): p is RawProductData => p !== null);
  }

  async fetchMarketOverview(_input: MarketInput): Promise<RawMarketData> {
    throw new Error('CSV 导入不支持市场概览抓取，请使用 fetchMarketProducts');
  }

  async fetchMarketProducts(_input: MarketInput): Promise<RawProductData[]> {
    return this.parseProducts();
  }

  async fetchProductDetail(input: ProductInput): Promise<RawProductData> {
    const found = this.parseProducts().find((p) => p.asin === input.asin);
    if (!found) throw new Error(`导入文件中不存在 ASIN: ${input.asin}`);
    return found;
  }

  async fetchReviews(_input: ProductInput): Promise<RawReviewData[]> {
    return [];
  }

  async fetchKeywordData(_input: KeywordInput): Promise<RawKeywordData> {
    throw new Error('CSV 导入不支持关键词抓取');
  }
}
