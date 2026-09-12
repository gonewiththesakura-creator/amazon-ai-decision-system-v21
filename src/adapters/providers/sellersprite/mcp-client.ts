/**
 * SellerSprite MCP Client（V2.2 §17）—— 真实 MCP Server 客户端
 * 传输：stdio（子进程 JSON-RPC 2.0 over stdin/stdout）。
 * 能力：connect（initialize 握手）→ tool discovery（tools/list）→ invoke（tools/call）
 * 超时 / 重试 / schema 校验 / 错误映射。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { ProviderError, type ProviderErrorCode } from '../types.js';

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRY = 2;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class McpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private connected = false;

  constructor(
    private readonly serverCommand: string,
    private readonly serverArgs: string[] = [],
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  /** 连接并完成 MCP initialize 握手 + 读取协议版本 */
  async connect(): Promise<{ protocolVersion: string; capabilities: string[] }> {
    if (this.connected) return { protocolVersion: '2024-11-05', capabilities: [] };
    const parts = this.serverCommand.split(/\s+/).filter(Boolean);
    const cmd = parts[0]!;
    const args = [...parts.slice(1), ...this.serverArgs];
    this.proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => this.onLine(line));
    this.proc.stderr.on('data', (d: Buffer) => {
      // MCP 服务器日志走 stderr，保留供排障
      void d;
    });
    this.proc.on('exit', () => {
      this.connected = false;
      this.rejectAll(new ProviderError('NETWORK', `MCP Server 进程退出（${cmd}）`, false));
    });
    // initialize 握手
    const init = (await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'amazon-ai-decision-system', version: '2.2.0' },
    })) as { protocolVersion?: string };
    // 通知 initialized
    await this.notify('notifications/initialized', {});
    this.connected = true;
    const tools = await this.listTools();
    return { protocolVersion: init.protocolVersion ?? 'unknown', capabilities: tools.map((t) => t.name) };
  }

  /** 工具发现（tools/list） */
  async listTools(): Promise<McpToolSchema[]> {
    const res = (await this.request('tools/list', {})) as { tools?: McpToolSchema[] };
    return res.tools ?? [];
  }

  /** 调用工具（tools/call），带 schema 校验与错误映射 */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!this.connected) throw new ProviderError('NETWORK', 'MCP 未连接', false);
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const res = (await this.request('tools/call', { name, arguments: args })) as McpCallResult;
        return res;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (e instanceof ProviderError && e.code === 'RATE_LIMIT') {
          await delay(500 * (attempt + 1));
          continue;
        }
        if (e instanceof ProviderError && (e.code === 'TIMEOUT' || e.code === 'NETWORK')) {
          await delay(300 * (attempt + 1));
          continue;
        }
        break;
      }
    }
    throw lastErr ?? new ProviderError('UNKNOWN', 'MCP 调用失败');
  }

  /** 关闭连接 */
  close(): void {
    this.rl?.close();
    try {
      this.proc?.kill();
    } catch {
      /* ignore */
    }
    this.connected = false;
  }

  private onLine(line: string): void {
    let msg: { id?: number; error?: { code: number; message: string }; result?: unknown };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    if (msg.id === undefined || msg.id === null) return; // 服务器主动通知
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) {
      const code: ProviderErrorCode = msg.error.code === -32005 ? 'RATE_LIMIT' : msg.error.code === -32001 ? 'TIMEOUT' : 'UNKNOWN';
      entry.reject(new ProviderError(code, `MCP ${msg.error.code}: ${msg.error.message}`, code === 'RATE_LIMIT'));
    } else {
      entry.resolve(msg.result);
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProviderError('TIMEOUT', `MCP ${method} 超时（${this.timeoutMs}ms）`, false));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc?.stdin.write(payload + '\n');
    });
  }

  private notify(method: string, params: unknown): Promise<void> {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
    return new Promise((resolve) => {
      this.proc?.stdin.write(payload + '\n');
      resolve();
    });
  }

  private rejectAll(e: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(e);
    }
    this.pending.clear();
  }
}
