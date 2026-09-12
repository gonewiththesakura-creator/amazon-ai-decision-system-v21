/**
 * BaseRemoteProvider（V2.2 §13-§15）—— 远程 Provider 基类
 * Connected 只能由 healthCheckRemote() 达成：先检查配置（UNCONFIGURED），再真实调用 verifyRemote()。
 * 配置齐备但未验证 → CONFIGURED（不是 Connected）；验证失败 → UNAUTHORIZED / RATE_LIMITED / ERROR / DEGRADED。
 */
import {
  ProviderError,
  type Capability,
  type ProviderBase,
  type ProviderConnectionStatus,
  type ProviderHealthResult,
} from './types.js';

export abstract class BaseRemoteProvider implements ProviderBase {
  abstract readonly name: string;
  abstract readonly capabilities: Capability[];

  /** 最近一次远程健康检查结果 */
  protected lastHealth: ProviderHealthResult | null = null;

  get isMock(): boolean {
    return false;
  }

  getLastHealth(): ProviderHealthResult | null {
    return this.lastHealth;
  }

  protected setHealth(h: ProviderHealthResult): void {
    this.lastHealth = h;
  }

  /** 子类覆盖：返回缺失的配置项（空 = 已配置） */
  protected abstract missingConfig(): string[];

  /** 子类覆盖：真实远程验证（仅当配置齐备时调用） */
  protected abstract verifyRemote(): Promise<ProviderHealthResult>;

  getStatus(): ProviderConnectionStatus {
    const h = this.lastHealth;
    if (h) {
      if (h.status === 'CONNECTED') return 'CONNECTED';
      if (h.status !== 'UNCONFIGURED') return h.status;
    }
    const missing = this.missingConfig();
    if (missing.length > 0) return 'UNCONFIGURED';
    return h ? h.status : 'CONFIGURED';
  }

  getStatusDetail(): string {
    const missing = this.missingConfig();
    const h = this.lastHealth;
    if (h && h.errorMessage) return h.errorMessage;
    if (missing.length > 0) return `缺少配置: ${missing.join(', ')}`;
    if (h?.status === 'CONNECTED') return `已连接（${h.checkedAt}，latency ${h.latencyMs ?? '?'}ms）`;
    return '配置齐备，尚未完成远程验证';
  }

  healthCheck(): Capability[] {
    return this.getStatus() === 'CONNECTED' ? this.capabilities : [];
  }

  /** 真实远程健康检查（唯一把状态推到 CONNECTED 的路径） */
  async healthCheckRemote(): Promise<ProviderHealthResult> {
    const missing = this.missingConfig();
    const started = Date.now();
    if (missing.length > 0) {
      const h: ProviderHealthResult = {
        status: 'UNCONFIGURED',
        checkedAt: new Date().toISOString(),
        capabilities: [],
        errorCode: 'UNCONFIGURED',
        errorMessage: `缺少配置: ${missing.join(', ')}`,
      };
      this.lastHealth = h;
      return h;
    }
    try {
      const h = await this.verifyRemote();
      h.latencyMs = Date.now() - started;
      this.lastHealth = h;
      return h;
    } catch (e) {
      const isProviderError = e instanceof ProviderError;
      const h: ProviderHealthResult = {
        status: isProviderError
          ? e.code === 'RATE_LIMIT'
            ? 'RATE_LIMITED'
            : e.code === 'AUTH_ERROR' || e.code === 'PERMISSION_DENIED'
              ? 'UNAUTHORIZED'
              : 'ERROR'
          : 'ERROR',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        capabilities: [],
        errorCode: isProviderError ? e.code : 'UNKNOWN',
        errorMessage: e instanceof Error ? e.message : String(e),
      };
      this.lastHealth = h;
      return h;
    }
  }

  protected unavailable(capability: Capability): never {
    throw new ProviderError(
      'UNKNOWN',
      `${this.name} 未连接（${this.getStatusDetail()}），无法提供能力 ${capability}`,
      false
    );
  }

  protected static env(name: string): string {
    return (process.env[name] ?? '').trim();
  }

  /** 公开访问 env（工具函数/静态上下文用） */
  static envOf(name: string): string {
    return (process.env[name] ?? '').trim();
  }

  /** 带超时的 HTTP GET（Node 全局 fetch） */
  protected static async httpGet(url: string, headers: Record<string, string>, timeoutMs = 15000): Promise<Response> {
    return BaseRemoteProvider.http('GET', url, headers, undefined, timeoutMs);
  }

  protected static async httpPost(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs = 15000
  ): Promise<Response> {
    return BaseRemoteProvider.http('POST', url, headers, body, timeoutMs);
  }

  private static async http(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number
  ): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const isAuth = res.status === 401 || res.status === 403;
        throw new ProviderError(
          isAuth ? 'AUTH_ERROR' : res.status === 429 ? 'RATE_LIMIT' : 'NETWORK',
          `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
          res.status === 429 || res.status >= 500
        );
      }
      return res;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new ProviderError('TIMEOUT', `请求超时（${timeoutMs}ms）: ${url}`, aborted ? false : true);
    } finally {
      clearTimeout(timer);
    }
  }
}
