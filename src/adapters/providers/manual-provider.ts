/**
 * Manual Provider（V2.1 §1.4）——人工录入：采购价/MOQ/包装/生产周期/头程/检测/供应商/合规/专利
 * V2.2：人工录入通道始终可用（CONNECTED 语义 = 通道就绪，非远程凭据）。
 */
import { getDatabase } from '../../db/connection.js';
import type { Capability, CostProvider, ProviderBase, ProviderConnectionStatus, ProviderHealthResult } from './types.js';

export class ManualProvider implements ProviderBase, CostProvider {
  readonly name = 'manual';
  readonly isMock = false;
  readonly capabilities: Capability[] = ['supply_chain', 'product_fees', 'review_text'];

  private lastHealth: ProviderHealthResult | null = null;

  getLastHealth(): ProviderHealthResult | null {
    return this.lastHealth;
  }

  getStatus(): ProviderConnectionStatus {
    return 'CONNECTED';
  }

  getStatusDetail(): string {
    return '人工录入通道（供应链/费用/评论）';
  }

  healthCheck(): Capability[] {
    try {
      const db = getDatabase();
      const owned = db.prepare('SELECT COUNT(*) AS n FROM owned_products').get() as { n: number };
      const supplyChainDone = db.prepare("SELECT COUNT(*) AS n FROM missing_data_items WHERE field = 'supply_chain_cost' AND status = 'open'").get() as { n: number };
      // 有自有 SKU 且无待补供应链缺口 → supply_chain 可用
      return owned.n > 0 && supplyChainDone.n === 0
        ? ['supply_chain', 'product_fees', 'review_text']
        : ['review_text'];
    } catch {
      return ['review_text'];
    }
  }

  async healthCheckRemote(): Promise<ProviderHealthResult> {
    const h: ProviderHealthResult = {
      status: 'CONNECTED',
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      capabilities: this.healthCheck(),
      errorMessage: '人工录入通道就绪',
    };
    this.lastHealth = h;
    return h;
  }

  async getProductFees(input: { asin: string; marketplace: string }): Promise<{ fba_fee: number; referral_fee: number; total: number }> {
    void input;
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'manual_fees_json'").get() as { value: string } | undefined;
    if (!row) throw new Error('manual: 未录入 FBA 费用');
    return JSON.parse(row.value) as { fba_fee: number; referral_fee: number; total: number };
  }

  async getSupplyChainCost(input: { sku: string }): Promise<Record<string, number>> {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'manual_supply_chain_json'").get() as { value: string } | undefined;
    if (!row) throw new Error(`manual: 未录入 ${input.sku} 供应链成本`);
    return JSON.parse(row.value) as Record<string, number>;
  }
}
