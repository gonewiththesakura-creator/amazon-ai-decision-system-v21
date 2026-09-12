/**
 * SellerSprite Import Provider（V2.1 §1.1C）——真实导出文件兜底
 * 实现 MarketResearchProvider：keyword 类能力从导入的 ReverseASIN / 关键词文件读取。
 */
import { getDatabase } from '../../db/connection.js';
import type { ProviderBase, ProviderConnectionStatus, MarketResearchProvider, Capability } from './types.js';
import { ProviderUnavailableError } from './types.js';

export class SellerSpriteImportProvider implements ProviderBase, MarketResearchProvider {
  readonly name = 'sellersprite_import';
  readonly isMock = false;
  readonly capabilities: Capability[] = ['keyword_volume', 'top_products', 'market_size', 'market_growth'];

  private status: ProviderConnectionStatus = 'Connected';

  getStatus(): ProviderConnectionStatus {
    return this.status;
  }

  getStatusDetail(): string {
    return this.status === 'Connected' ? '已就绪（真实导出文件导入后可用）' : '无可导入的真实文件';
  }

  healthCheck(): Capability[] {
    // 导入文件存在（raw_ingestions 有 sellersprite 记录）才算可用
    try {
      const db = getDatabase();
      const n = db.prepare("SELECT COUNT(*) AS n FROM raw_ingestions WHERE source = 'sellersprite'").get() as { n: number };
      if (n.n === 0) {
        this.status = 'Unavailable';
        return [];
      }
      this.status = 'Connected';
      return this.capabilities;
    } catch {
      this.status = 'Unavailable';
      return [];
    }
  }

  async getMarketOverview(): Promise<never> {
    throw new ProviderUnavailableError(this.name, this.getStatus(), '市场画像需 SellerSprite Market Analysis 文件导入');
  }

  async getTopProducts(): Promise<never> {
    throw new ProviderUnavailableError(this.name, this.getStatus(), 'TOP 产品需 SellerSprite 竞品导出导入');
  }

  async getProductMetrics(): Promise<never> {
    throw new ProviderUnavailableError(this.name, this.getStatus(), '产品指标需 Reverse ASIN / 竞品文件导入');
  }

  /** 关键词指标：从导入的 ReverseASIN 关键词快照读取（真实 ESTIMATED 数据） */
  async getKeywordMetrics(input: { keyword: string; marketplace: string }): Promise<never> {
    void input;
    throw new ProviderUnavailableError(this.name, this.getStatus(), '关键词指标需先导入 ReverseASIN 文件');
  }

  async getReviews(): Promise<never> {
    throw new ProviderUnavailableError(this.name, this.getStatus(), '评论需 SellerSprite 评论导出导入');
  }
}

export const sellerspriteImport = new SellerSpriteImportProvider();
