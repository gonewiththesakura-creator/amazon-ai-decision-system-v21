/**
 * ManualInputAdapter —— 人工录入适配器
 * 用于手工维护自有 SKU / 竞品 / 市场数据（无自动数据源时的补充通道）
 */
import type {
  KeywordInput,
  MarketDataAdapter,
  MarketInput,
  ProductInput,
  RawKeywordData,
  RawMarketData,
  RawProductData,
  RawReviewData,
} from '../types.js';

export class ManualInputAdapter implements MarketDataAdapter {
  readonly name = 'manual';

  private products: RawProductData[] = [];
  private markets: RawMarketData[] = [];

  addProduct(p: RawProductData): void {
    this.products.push(p);
  }

  addMarket(m: RawMarketData): void {
    this.markets.push(m);
  }

  async fetchMarketOverview(input: MarketInput): Promise<RawMarketData> {
    const found = this.markets.find((m) => m.market_name === input.market_name);
    if (!found) throw new Error(`人工录入中不存在市场: ${input.market_name}`);
    return found;
  }

  async fetchMarketProducts(_input: MarketInput): Promise<RawProductData[]> {
    return this.products;
  }

  async fetchProductDetail(input: ProductInput): Promise<RawProductData> {
    const found = this.products.find((p) => p.asin === input.asin);
    if (!found) throw new Error(`人工录入中不存在 ASIN: ${input.asin}`);
    return found;
  }

  async fetchReviews(_input: ProductInput): Promise<RawReviewData[]> {
    return [];
  }

  async fetchKeywordData(_input: KeywordInput): Promise<RawKeywordData> {
    throw new Error('人工录入不支持关键词抓取');
  }
}
