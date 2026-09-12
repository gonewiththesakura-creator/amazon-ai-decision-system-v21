/**
 * MockAdapter —— 演示数据适配器
 * 全部输出 is_demo=true，严禁伪装真实数据
 * 使用固定种子 PRNG，同一种子下数据完全可复现（测试依赖此特性）
 */
import type {
  KeywordInput,
  MarketDataAdapter,
  MarketInput,
  ProductInput,
  RawKeywordData,
  RawMarketData,
  RawMarketSnapshot,
  RawProductData,
  RawProductSnapshot,
  RawReviewData,
} from '../types.js';

/** mulberry32 确定性伪随机数生成器 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MOCK_SOURCE = 'SellerSprite(Mock)';
export const MOCK_SOURCE_TYPE = 'mock';

// ===== 市场画像（演示数据的业务底稿）=====
interface MarketProfile {
  baseSales: number; // 月销量基数
  growth30d: number; // 30D 增速（%）
  growth90d: number;
  productCount: number;
  avgPrice: number;
  priceSpread: number;
  reviewMedian: number;
  concentration: number; // TOP10 销量占比
  newProductShare: number; // 新品占比
  brandCount: number;
  sellerCount: number;
}

const TODAY = '2026-09-11';
const DAY = 24 * 60 * 60 * 1000;
export const snapshotDates = (daysBack: number[]): string[] =>
  daysBack.map((d) => new Date(new Date(TODAY + 'T00:00:00Z').getTime() - d * DAY).toISOString().slice(0, 10));

export const MARKET_PROFILES: Record<string, MarketProfile> = {
  'Memory Foam Pillow': { baseSales: 118000, growth30d: 8.2, growth90d: 14.6, productCount: 9200, avgPrice: 34.5, priceSpread: 12, reviewMedian: 210, concentration: 0.42, newProductShare: 0.06, brandCount: 1450, sellerCount: 2100 },
  'Cervical Pillow': { baseSales: 26000, growth30d: -8.4, growth90d: -4.2, productCount: 1900, avgPrice: 38.9, priceSpread: 14, reviewMedian: 260, concentration: 0.55, newProductShare: 0.04, brandCount: 420, sellerCount: 640 },
  'Contour Pillow': { baseSales: 31500, growth30d: 12.1, growth90d: 18.9, productCount: 1500, avgPrice: 36.2, priceSpread: 11, reviewMedian: 320, concentration: 0.38, newProductShare: 0.08, brandCount: 360, sellerCount: 540 },
  'Ergonomic Pillow': { baseSales: 22800, growth30d: 6.3, growth90d: 9.7, productCount: 2300, avgPrice: 41.5, priceSpread: 15, reviewMedian: 180, concentration: 0.47, newProductShare: 0.05, brandCount: 480, sellerCount: 720 },
  'Neck Support Pillow': { baseSales: 18200, growth30d: 15.2, growth90d: 21.4, productCount: 1200, avgPrice: 33.8, priceSpread: 10, reviewMedian: 240, concentration: 0.33, newProductShare: 0.11, brandCount: 310, sellerCount: 480 },
  'Side Sleeper Pillow': { baseSales: 19800, growth30d: 4.8, growth90d: 6.1, productCount: 1600, avgPrice: 39.6, priceSpread: 13, reviewMedian: 280, concentration: 0.44, newProductShare: 0.05, brandCount: 380, sellerCount: 560 },
  'Back Sleeper Pillow': { baseSales: 12400, growth30d: -2.6, growth90d: 1.2, productCount: 980, avgPrice: 37.4, priceSpread: 12, reviewMedian: 200, concentration: 0.51, newProductShare: 0.04, brandCount: 240, sellerCount: 360 },
  'Memory Foam Lumbar Pillow': { baseSales: 15800, growth30d: 18.4, growth90d: 26.7, productCount: 1100, avgPrice: 29.9, priceSpread: 9, reviewMedian: 150, concentration: 0.29, newProductShare: 0.14, brandCount: 290, sellerCount: 440 },
  'Memory Foam U-Shaped Pillow': { baseSales: 12600, growth30d: 17.9, growth90d: 24.3, productCount: 860, avgPrice: 27.5, priceSpread: 8, reviewMedian: 120, concentration: 0.31, newProductShare: 0.13, brandCount: 230, sellerCount: 350 },
  'Memory Foam Seat Cushion': { baseSales: 9800, growth30d: 9.5, growth90d: 13.8, productCount: 1500, avgPrice: 31.2, priceSpread: 10, reviewMedian: 190, concentration: 0.36, newProductShare: 0.09, brandCount: 340, sellerCount: 510 },
  'Memory Foam Leg Pillow': { baseSales: 5400, growth30d: -1.8, growth90d: 2.4, productCount: 520, avgPrice: 24.8, priceSpread: 7, reviewMedian: 90, concentration: 0.48, newProductShare: 0.05, brandCount: 120, sellerCount: 180 },
  'Electric Massage Pillow': { baseSales: 7600, growth30d: 11.2, growth90d: 16.9, productCount: 700, avgPrice: 52.6, priceSpread: 18, reviewMedian: 260, concentration: 0.58, newProductShare: 0.06, brandCount: 180, sellerCount: 260 },
};

// ===== 自有 SKU 画像（4 个记忆棉枕头，V2 验收任务 A 的"灰色枕头"即 SKU-A）=====
export interface OwnedSkuProfile {
  sku: string;
  asin: string;
  internalName: string;
  marketName: string;
  price: number;
  reviewCount: number;
  rating: number;
  bsr: number;
  sales30d: number;
  /** 相对市场的 30D 增量（%） */
  relative30d: number;
  growth90d: number;
}

export const OWNED_SKU_PROFILES: OwnedSkuProfile[] = [
  { sku: 'SKU-A', asin: 'B0DEMOA001', internalName: '灰色人体工学记忆棉枕（Contour）', marketName: 'Contour Pillow', price: 36.9, reviewCount: 1240, rating: 4.3, bsr: 3800, sales30d: 620, relative30d: -11.3, growth90d: 1.4 },
  { sku: 'SKU-B', asin: 'B0DEMOB002', internalName: '蓝色记忆棉颈椎枕（Ergonomic）', marketName: 'Ergonomic Pillow', price: 41.9, reviewCount: 860, rating: 4.5, bsr: 5200, sales30d: 410, relative30d: 2.4, growth90d: 9.2 },
  { sku: 'SKU-C', asin: 'B0DEMOC003', internalName: '白色蝶形颈椎牵引枕（Cervical）', marketName: 'Cervical Pillow', price: 38.5, reviewCount: 2100, rating: 4.2, bsr: 2900, sales30d: 530, relative30d: 2.1, growth90d: -5.8 },
  { sku: 'SKU-D', asin: 'B0DEMOD004', internalName: '记忆棉颈枕支撑枕（Neck Support）', marketName: 'Neck Support Pillow', price: 33.9, reviewCount: 540, rating: 4.6, bsr: 6800, sales30d: 280, relative30d: 1.9, growth90d: 17.6 },
];

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** 从市场名生成确定性种子，保证同名市场数据一致 */
function seedFor(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function marketSnapshots(profile: MarketProfile, marketName: string): RawMarketSnapshot[] {
  const rnd = seededRandom(seedFor(marketName));
  const dates = snapshotDates([180, 90, 30, 7, 0]);
  const salesBase = profile.baseSales;
  // 用 growth30d / growth90d 反推历史销量（近似线性+噪声）
  const salesAt = (days: number) => {
    const t = days / 30;
    const factor = Math.pow(1 + profile.growth30d / 100, -t) * (1 + (rnd() - 0.5) * 0.02);
    return Math.max(100, Math.round(salesBase * factor));
  };
  return dates.map((date, i) => {
    const days = [180, 90, 30, 7, 0][i]!;
    const sales = salesAt(days);
    return {
      date,
      monthly_sales: sales,
      monthly_revenue: Math.round(sales * profile.avgPrice),
      product_count: Math.round(profile.productCount * (1 - days / 3650)),
      avg_price: round2(profile.avgPrice * (1 + (rnd() - 0.5) * 0.03)),
      median_price: round2(profile.avgPrice * 0.92),
    };
  });
}

export class MockAdapter implements MarketDataAdapter {
  readonly name = 'mock';

  async fetchMarketOverview(input: MarketInput): Promise<RawMarketData> {
    const name = input.market_name;
    const profile =
      MARKET_PROFILES[name] ??
      // 未知市场：由名称哈希派生画像（用于新赛道演示）
      (() => {
        const rnd = seededRandom(seedFor(name));
        const g30 = round1((rnd() - 0.3) * 40);
        return {
          baseSales: Math.round(5000 + rnd() * 45000),
          growth30d: g30,
          growth90d: round1(g30 * 1.4),
          productCount: Math.round(300 + rnd() * 3000),
          avgPrice: round1(10 + rnd() * 50),
          priceSpread: 10,
          reviewMedian: Math.round(50 + rnd() * 300),
          concentration: round2(0.25 + rnd() * 0.35),
          newProductShare: round2(0.03 + rnd() * 0.12),
          brandCount: Math.round(60 + rnd() * 500),
          sellerCount: Math.round(80 + rnd() * 700),
        };
      })();

    const snapshots = marketSnapshots(profile, name);
    const latest = snapshots[snapshots.length - 1]!;
    return {
      market_name: name,
      marketplace: input.marketplace,
      monthly_sales: latest.monthly_sales,
      monthly_revenue: latest.monthly_revenue,
      product_count: latest.product_count,
      seller_count: profile.sellerCount,
      brand_count: profile.brandCount,
      avg_price: latest.avg_price,
      median_price: latest.median_price,
      avg_rating: 4.3,
      median_reviews: profile.reviewMedian,
      new_product_count: Math.round(latest.product_count! * profile.newProductShare),
      top10_sales_share: profile.concentration,
      top20_sales_share: round2(profile.concentration * 1.55),
      source: MOCK_SOURCE,
      source_type: MOCK_SOURCE_TYPE,
      collected_at: new Date().toISOString(),
      is_estimated: true,
      confidence: 0.9,
      snapshots,
    };
  }

  async fetchMarketProducts(input: MarketInput, limit = 100): Promise<RawProductData[]> {
    const name = input.market_name;
    const profile = MARKET_PROFILES[name] ?? {
      baseSales: 8000,
      growth30d: 10,
      growth90d: 14,
      productCount: 1000,
      avgPrice: 30,
      priceSpread: 10,
      reviewMedian: 150,
      concentration: 0.4,
      newProductShare: 0.06,
      brandCount: 200,
      sellerCount: 300,
    };
    const rnd = seededRandom(seedFor(name) ^ 0x5f3759df);
    const dates = snapshotDates([90, 30, 7, 0]);
    const products: RawProductData[] = [];
    const brandPool = ['ZINUS', 'EPABO', 'COONICE', 'Dewberry', 'ELOVNOVA', 'TEMPUR', 'Beckham', 'SINBAB', 'Dreamary', 'LINENSPA'];
    for (let i = 0; i < limit; i++) {
      const isNew = rnd() < (profile.newProductShare ?? 0.06);
      const price = round1(profile.avgPrice * (0.7 + rnd() * 0.7));
      const baseSales = Math.max(
        30,
        Math.round((profile.baseSales / limit) * (0.25 + rnd() * 1.8) * (isNew ? 0.6 : 1))
      );
      const growth = round1((rnd() - 0.45) * 45);
      const salesSeries = dates.map((date, di) => {
        const days = [90, 30, 7, 0][di]!;
        const factor = Math.pow(1 + growth / 100, -(days / 30)) * (1 + (rnd() - 0.5) * 0.05);
        return { date, estimated_sales: Math.max(10, Math.round(baseSales * factor)) };
      });
      const asin = `B0MOCK${String(i).padStart(3, '0')}${name.slice(0, 3).toUpperCase()}`.replace(/[^A-Z0-9]/g, 'X').slice(0, 10);
      const snapshots: RawProductSnapshot[] = salesSeries.map((s, si) => ({
        date: s.date,
        price: round1(price * (1 + (rnd() - 0.5) * 0.08)),
        rating: round2(3.8 + rnd() * 0.7),
        review_count: Math.round((30 + rnd() * 500) * (si / 4 + 0.3)),
        bsr: Math.round(800 + rnd() * 12000),
        estimated_sales: s.estimated_sales,
      }));
      const latest = snapshots[snapshots.length - 1]!;
      products.push({
        asin,
        brand: brandPool[Math.floor(rnd() * brandPool.length)]!,
        title: `${brandPool[Math.floor(rnd() * brandPool.length)]} ${name} ${isNew ? '2026 New' : 'Ergonomic'} - Memory Foam`,
        image_url: null,
        market_name: name,
        price: latest.price,
        rating: latest.rating,
        review_count: latest.review_count,
        bsr: latest.bsr,
        estimated_sales_30d: latest.estimated_sales,
        estimated_revenue_30d: Math.round(latest.estimated_sales! * latest.price!),
        coupon: rnd() < 0.15 ? round1(rnd() * 6) : null,
        seller_count: Math.round(1 + rnd() * 8),
        source: MOCK_SOURCE,
        source_type: MOCK_SOURCE_TYPE,
        collected_at: new Date().toISOString(),
        is_estimated: true,
        confidence: 0.9,
        snapshots,
      });
    }
    // 按销量排序模拟 TOP100
    products.sort((a, b) => (b.estimated_sales_30d ?? 0) - (a.estimated_sales_30d ?? 0));
    return products.slice(0, limit);
  }

  async fetchProductDetail(input: ProductInput): Promise<RawProductData> {
    const products = await this.fetchMarketProducts({ market_name: 'Memory Foam Pillow', marketplace: input.marketplace }, 200);
    const found = products.find((p) => p.asin === input.asin);
    if (found) return found;
    // 自有 SKU 直查
    const owned = OWNED_SKU_PROFILES.find((p) => p.asin === input.asin);
    if (owned) return ownedToRaw(owned);
    throw new Error(`Mock 数据中不存在 ASIN: ${input.asin}`);
  }

  async fetchReviews(input: ProductInput, limit = 60): Promise<RawReviewData[]> {
    const rnd = seededRandom(seedFor(input.asin));
    const issues = [
      'too firm 太硬，睡了一周颈部更痛了',
      'smell 有很重的化学气味，放了三天才散',
      'too soft 太软了，支撑不够',
      'neck pressure 颈部压力大，第二天早上不舒服',
      'center sags 用了两个月中间凹陷',
      'pillowcase 枕套起球，拉链容易坏',
      'size 尺寸偏小，和描述不符',
      'temperature 睡一会儿就很热，不透气',
      'cleaning 不能水洗，清洁麻烦',
      'packaging 包装破损，压缩卷打开后恢复很慢',
      'expectation 以为是护颈枕头，实际就是普通海绵枕',
      'good 很舒服，睡眠质量提升了',
      'great 性价比高，推荐',
      'okay 一般般，没什么特别',
    ];
    const reviews: RawReviewData[] = [];
    for (let i = 0; i < limit; i++) {
      reviews.push({
        asin: input.asin,
        text: issues[Math.floor(rnd() * issues.length)]!,
        rating: round1(2 + rnd() * 3),
        review_date: new Date(Date.now() - Math.floor(rnd() * 120) * DAY).toISOString().slice(0, 10),
        source: `${MOCK_SOURCE}/reviews`,
      });
    }
    return reviews;
  }

  async fetchKeywordData(input: KeywordInput): Promise<RawKeywordData> {
    const rnd = seededRandom(seedFor(input.keyword));
    return {
      keyword: input.keyword,
      search_volume: Math.round(2000 + rnd() * 80000),
      trend: round1((rnd() - 0.4) * 60),
      competing_products: Math.round(200 + rnd() * 3000),
      aba_click_share: round2(rnd() * 0.3),
      aba_conversion_share: round2(rnd() * 0.2),
      bid: round2(0.3 + rnd() * 2.5),
      source: MOCK_SOURCE,
      source_type: MOCK_SOURCE_TYPE,
      collected_at: new Date().toISOString(),
    };
  }
}

export function ownedToRaw(p: OwnedSkuProfile): RawProductData {
  const marketProfile = MARKET_PROFILES[p.marketName];
  const dates = snapshotDates([90, 30, 7, 0]);
  const g30 = marketProfile ? marketProfile.growth30d + p.relative30d : p.growth90d / 3;
  const salesSeries = dates.map((date, di) => {
    const days = [90, 30, 7, 0][di]!;
    const factor = Math.pow(1 + g30 / 100, -(days / 30));
    return { date, estimated_sales: Math.max(20, Math.round(p.sales30d * factor)) };
  });
  const snapshots: RawProductSnapshot[] = salesSeries.map((s, si) => ({
    date: s.date,
    price: round1(p.price * (1 + (si === 3 ? -0.02 : 0))),
    rating: p.rating,
    review_count: Math.round(p.reviewCount * (0.82 + si * 0.06)),
    bsr: Math.round(p.bsr * (1 - si * 0.02)),
    estimated_sales: s.estimated_sales,
  }));
  return {
    asin: p.asin,
    brand: 'ELOVNOVA',
    title: p.internalName,
    image_url: null,
    market_name: p.marketName,
    price: p.price,
    rating: p.rating,
    review_count: p.reviewCount,
    bsr: p.bsr,
    estimated_sales_30d: p.sales30d,
    estimated_revenue_30d: Math.round(p.sales30d * p.price),
    coupon: null,
    seller_count: 1,
    source: MOCK_SOURCE,
    source_type: MOCK_SOURCE_TYPE,
    collected_at: new Date().toISOString(),
    is_estimated: true,
    confidence: 0.9,
    snapshots,
  };
}
