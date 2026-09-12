/**
 * DataProviderRegistry（V2.1 §2）
 * 统一注册所有 Provider；业务层通过"能力"解析 Provider，而非硬编码数据源名。
 * REAL 模式禁止解析到 Mock；能力缺失 → NeedsDataError（工作流转 needs_data）。
 */
import { SOURCE_PRIORITY } from '../../config/source-priority.js';
import { getMode, type SystemMode } from '../../config/mode.js';
import { getDatabase } from '../../db/connection.js';
import {
  NeedsDataError,
  type Capability,
  type ProviderBase,
  type ProviderConnectionStatus,
} from './types.js';

export interface RegisteredProvider extends ProviderBase {
  /** 实现的能力接口（按能力向下转型调用） */
  impl: unknown;
}

export class DataProviderRegistry {
  private providers = new Map<string, RegisteredProvider>();

  register(p: ProviderBase): void {
    // 保留原型方法（不可用展开 {...p}，会丢失 class prototype 上的方法）
    (p as RegisteredProvider).impl = p;
    this.providers.set(p.name, p as RegisteredProvider);
  }

  get(name: string): RegisteredProvider {
    const p = this.providers.get(name);
    if (!p) throw new Error(`未注册 Provider: ${name}`);
    return p;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }

  /** 按能力 + 模式解析最佳 Provider（SourcePriority 链） */
  resolveForCapability(capability: Capability, mode?: SystemMode): RegisteredProvider {
    const m = mode ?? getMode();
    const chain = SOURCE_PRIORITY[capability as keyof typeof SOURCE_PRIORITY] ?? [];
    for (const name of chain) {
      const p = this.providers.get(name);
      if (!p) continue;
      if (m === 'REAL' && p.isMock) continue;
      if (p.healthCheck().includes(capability)) return p;
    }
    const usable = this.listStatus().filter((s) => s.status === 'Connected').map((s) => s.provider);
    throw new NeedsDataError(
      [capability],
      usable.length ? usable : chain.filter((n) => this.providers.has(n)),
      m === 'REAL'
        ? `当前缺少 SellerSprite / Amazon 数据，无法形成真实业务结论（能力: ${capability}）`
        : `能力 ${capability} 无可用的数据 Provider`
    );
  }

  /** 一组能力解析结果：返回 { capability → provider } 与缺失清单 */
  planCapabilities(capabilities: Capability[], mode?: SystemMode): { resolved: Map<Capability, RegisteredProvider>; missing: Capability[] } {
    const m = mode ?? getMode();
    const resolved = new Map<Capability, RegisteredProvider>();
    const missing: Capability[] = [];
    for (const c of capabilities) {
      try {
        resolved.set(c, this.resolveForCapability(c, m));
      } catch {
        missing.push(c);
      }
    }
    return { resolved, missing };
  }

  /** 全量状态（§14 系统设置页） */
  listStatus(): Array<{ provider: string; status: ProviderConnectionStatus; detail: string; isMock: boolean; capabilities: Capability[] }> {
    return [...this.providers.values()].map((p) => ({
      provider: p.name,
      status: p.getStatus(),
      detail: p.getStatusDetail(),
      isMock: p.isMock,
      capabilities: p.healthCheck(),
    }));
  }

  /** 同步状态到 provider_status 表（UI/对账可查） */
  syncStatusToDb(): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO provider_status (provider, status, config_hint, last_checked_at, health_detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET status = excluded.status, config_hint = excluded.config_hint,
         last_checked_at = excluded.last_checked_at, health_detail = excluded.health_detail`
    );
    for (const s of this.listStatus()) {
      upsert.run(s.provider, s.status, s.detail, now, JSON.stringify({ is_mock: s.isMock, capabilities: s.capabilities }), now);
    }
  }

  /** 数据能力矩阵（§4）：capability × provider 可用性 */
  capabilityMatrix(): Array<{ capability: Capability; provider: string; available: boolean; priority: number }> {
    const out: Array<{ capability: Capability; provider: string; available: boolean; priority: number }> = [];
    const allCapabilities = new Set<Capability>();
    for (const p of this.providers.values()) p.capabilities.forEach((c) => allCapabilities.add(c));
    for (const capability of allCapabilities) {
      const chain = SOURCE_PRIORITY[capability as keyof typeof SOURCE_PRIORITY] ?? [];
      chain.forEach((provider, idx) => {
        if (!this.providers.has(provider)) return;
        const p = this.providers.get(provider)!;
        out.push({ capability, provider, available: p.healthCheck().includes(capability), priority: idx + 1 });
      });
    }
    return out;
  }
}

export const providerRegistry = new DataProviderRegistry();
