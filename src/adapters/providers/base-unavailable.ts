/**
 * 未授权 Provider 基类（V2.1 §14/§15/§16）
 * 接口、数据模型、认证配置、错误处理先做好；未授权时状态如实标注 Unauthorized，
 * 能力 healthCheck 返回空集（REAL 模式 resolve 会得到 NeedsDataError，绝不 fallback Mock）。
 */
import { ProviderUnavailableError, type Capability, type ProviderBase, type ProviderConnectionStatus } from './types.js';

export abstract class BaseUnavailableProvider implements ProviderBase {
  abstract readonly name: string;
  abstract readonly capabilities: Capability[];

  get isMock(): boolean {
    return false;
  }

  /** 子类覆盖：返回缺失的配置项说明（空 = 已配置） */
  protected abstract missingConfig(): string[];

  getStatus(): ProviderConnectionStatus {
    const missing = this.missingConfig();
    if (missing.length === 0) return 'Connected';
    // 有配置但从未探测：仍算 Unauthorized（保守）
    return 'Unauthorized';
  }

  getStatusDetail(): string {
    const missing = this.missingConfig();
    if (missing.length === 0) return '已配置';
    return `缺少配置: ${missing.join(', ')}`;
  }

  healthCheck(): Capability[] {
    return this.getStatus() === 'Connected' ? this.capabilities : [];
  }

  protected unavailable(capability: Capability): never {
    throw new ProviderUnavailableError(
      this.name,
      this.getStatus(),
      `${this.name} 未授权/不可用（${this.getStatusDetail()}），无法提供能力 ${capability}`
    );
  }

  protected static env(name: string): string {
    return (process.env[name] ?? '').trim();
  }
}
