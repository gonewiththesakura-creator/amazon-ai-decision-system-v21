/**
 * V2.2 HTTP Black Box Tests（§49-§54）
 * 约束：只允许"启动服务 → 调用 HTTP API → 读取 HTTP 结果"。
 * 禁止 import：rule engine / database engine / 任何内部 helper（本文件仅使用 node 标准库）。
 *
 * Case A：REAL + Sentinel Real Provider（market_987654）→ existing_market → run
 *         → 最终 Evidence Trace 出现 987654（Snapshot / Metric / Evidence 任一序列化即包含）
 * Case B：REAL 无 Provider → run → needs_data，且无任何 Mock 记录
 * Case C：非法 approve（非 waiting_approval）→ 403
 * Case D：上传错误 SellerSprite（未知字段）→ mapping_queue
 * Case E：Amazon Report 缺失字段 → null / missing（禁止补 0）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

const ROOT = resolve(import.meta.dirname, '../..');

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolvePort(port));
    });
  });
}

interface RunningServer {
  child: ChildProcess;
  base: string;
  dir: string;
}

async function startServer(env: Record<string, string>, mode?: 'DEMO' | 'REAL' | 'HYBRID'): Promise<RunningServer> {
  const dir = mkdtempSync(join(tmpdir(), 'v22bb-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_PATH: join(dir, 'test.db'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  child.stdout?.on('data', (d: Buffer) => { logs += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { logs += d.toString(); });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`服务提前退出（exit=${child.exitCode}）：${logs.slice(0, 800)}`);
    }
    try {
      const r = await fetch(`${base}/api/system/mode`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) break;
    } catch {
      /* 尚未就绪 */
    }
    if (Date.now() > deadline) throw new Error(`服务启动超时：${logs.slice(0, 800)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  if (mode) {
    const r = await fetch(`${base}/api/system/mode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!r.ok) throw new Error(`切换模式 ${mode} 失败：${await r.text()}`);
  }
  return { child, base, dir };
}

async function stopServer(s: RunningServer): Promise<void> {
  if (s.child.exitCode === null) s.child.kill();
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(s.dir, { recursive: true, force: true });
  } catch {
    /* 临时目录清理失败不阻塞 */
  }
}

async function api<T = unknown>(
  base: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const r = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: r.status, data: data as T };
}

test('V2.2 §49-54 HTTP Black Box（只启动服务 + HTTP，不 import 内部模块）', async (t) => {
  // ============ Case A：REAL + Sentinel（market_987654）→ Evidence 出现 987654 ============
  await t.test('Case A：REAL + Sentinel Real Provider → Evidence Trace 出现 987654', async () => {
    const s = await startServer({ SENTINEL_PROVIDER: 'market' }, 'REAL');
    try {
      const mode = await api<{ mode: string }>(s.base, 'GET', '/api/system/mode');
      assert.equal(mode.data.mode, 'REAL', '服务必须以 REAL 模式启动');

      const health = await api<{ results: Array<{ provider: string; status: string }> }>(s.base, 'POST', '/api/providers/health/refresh');
      const sentinel = health.data.results?.find((x) => x.provider === 'sentinel_market');
      assert.ok(sentinel, 'sentinel_market 必须已注册并完成真实健康检查');
      assert.equal(sentinel.status, 'CONNECTED');

      const created = await api<{ id: number; status: string }>(s.base, 'POST', '/api/research-jobs', {
        name: 'BB Case A Sentinel',
        job_type: 'existing_market',
        marketplace: 'US',
        target: 'Sentinel Pillow',
        description: 'Black Box Case A：REAL + Sentinel',
      });
      assert.equal(created.status, 201, '创建任务应 201');
      const jobId = created.data.id;

      const run = await api<{ status: string }>(s.base, 'POST', `/api/research-jobs/${jobId}/run`);
      assert.equal(run.status, 200, `run 应成功（${JSON.stringify(run.data)}）`);
      assert.notEqual(run.data.status, 'needs_data', `REAL + Sentinel 应能解析 Provider（${JSON.stringify(run.data)}）`);

      // Evidence：987654 必须出现在 Evidence Trace（序列化整体包含即满足"出现在 Snapshot/Metric/Evidence"）
      const ev = await api<unknown[]>(s.base, 'GET', `/api/research-jobs/${jobId}/evidence`);
      const evText = JSON.stringify(ev.data);
      assert.ok(ev.data.length > 0, '必须产生 Evidence');
      assert.ok(evText.includes('987654'), `Evidence Trace 必须出现 987654，实际: ${evText.slice(0, 500)}`);

      // Snapshot：市场快照 monthly_sales = 987654
      const markets = await api<Array<{ id: number; name: string }>>(s.base, 'GET', '/api/markets');
      const sentinelMarket = markets.data.find((m) => m.name === 'Sentinel Pillow');
      assert.ok(sentinelMarket, '必须创建 Sentinel Pillow 市场节点');
      const snaps = await api<Array<{ monthly_sales: number | null }>>(s.base, 'GET', `/api/markets/${sentinelMarket.id}/snapshots`);
      assert.ok(snaps.data.some((x) => x.monthly_sales === 987654), '市场快照必须包含 monthly_sales=987654');
    } finally {
      await stopServer(s);
    }
  });

  // ============ Case B：REAL 无 Provider → needs_data，且无 Mock 记录 ============
  await t.test('Case B：REAL 无 Provider → run 返回 needs_data，无任何 Mock 记录', async () => {
    const s = await startServer({}, 'REAL'); // 无 SENTINEL、无真实凭据 → 所有真实 Provider UNCONFIGURED
    try {
      const created = await api<{ id: number }>(s.base, 'POST', '/api/research-jobs', {
        name: 'BB Case B No Provider',
        job_type: 'existing_market',
        marketplace: 'US',
        target: 'Nonexistent Market',
      });
      assert.equal(created.status, 201);
      const run = await api<{ status: string }>(s.base, 'POST', `/api/research-jobs/${created.data.id}/run`);
      assert.equal(run.status, 200, 'run 端点应返回 200 而非抛错');
      assert.equal(run.data.status, 'needs_data', `REAL 无 Provider 必须 needs_data（实际 ${run.data.status}）`);

      // 不能有任何 Mock 记录：Evidence 必须为空
      const ev = await api<unknown[]>(s.base, 'GET', `/api/research-jobs/${created.data.id}/evidence`);
      assert.equal(ev.data.length, 0, 'needs_data 任务不允许产生任何 Evidence/Mock 记录');

      // 缺失能力写入 missing-data
      const missing = await api<Array<{ field: string }>>(s.base, 'GET', `/api/research-jobs/${created.data.id}/missing-data`);
      assert.ok(missing.data.length > 0, '必须记录缺失能力');
    } finally {
      await stopServer(s);
    }
  });

  // ============ Case C：非法 approve（非 waiting_approval）→ 403/409 ============
  await t.test('Case C：非 waiting_approval 状态直接 approve → 403/409', async () => {
    const s = await startServer({}, 'REAL');
    try {
      const created = await api<{ id: number }>(s.base, 'POST', '/api/research-jobs', {
        name: 'BB Case C Approval Bypass',
        job_type: 'new_opportunity',
        marketplace: 'US',
        target: 'Some Idea',
      });
      assert.equal(created.status, 201);
      // 不 run，直接在 draft 状态 approve → 必须被拒绝
      const approve = await api<{ error: string; code?: string }>(s.base, 'POST', `/api/research-jobs/${created.data.id}/approve`, { decided_by: 'tester' });
      assert.ok(approve.status === 403 || approve.status === 409, `非法 approve 必须 403/409（实际 ${approve.status}）`);
      assert.ok(approve.data.code === 'APPROVAL_BYPASS_BLOCKED' || /waiting_approval/.test(approve.data.error ?? ''), '必须返回审批绕过拦截原因');
    } finally {
      await stopServer(s);
    }
  });

  // ============ Case D：错误 SellerSprite（未知字段）→ mapping_queue ============
  await t.test('Case D：SellerSprite 文件含未知字段 → 进入 mapping_queue（不静默丢弃）', async () => {
    const s = await startServer({}, 'REAL');
    const csvPath = join(s.dir, 'bad-sellersprite.csv');
    try {
      writeFileSync(
        csvPath,
        ['ASIN,品牌,月销量,unknown_column_xyz', 'B0TESTD001,BrandX,123,hello-world'].join('\n'),
        'utf8'
      );
      const imp = await api<{ ok: boolean; ingestionId?: number; unmapped?: string[] }>(
        s.base,
        'POST',
        '/api/import/sellersprite/reverse-asin',
        { file_path: csvPath, marketplace: 'MX', asin: 'B0TESTD001' }
      );
      assert.equal(imp.status, 201, `导入应成功（${JSON.stringify(imp.data)}）`);
      const queue = await api<Array<{ source_column: string; status: string }>>(s.base, 'GET', '/api/mapping-queue');
      assert.ok(
        queue.data.some((x) => x.source_column === 'unknown_column_xyz' && x.status === 'pending'),
        `未知列必须进入 mapping_queue，实际队列: ${JSON.stringify(queue.data)}`
      );
    } finally {
      await stopServer(s);
    }
  });

  // ============ Case E：Amazon Report 缺失字段 → null / missing（禁止补 0） ============
  await t.test('Case E：Amazon 报表缺失字段保留 null / missing，禁止补 0', async () => {
    const s = await startServer({}, 'REAL');
    const csvPath = join(s.dir, 'business-missing.csv');
    try {
      writeFileSync(
        csvPath,
        ['asin,date,unitsOrdered,orderedProductSales', 'B0TESTE001,2026-08-01,,99.5'].join('\n'),
        'utf8'
      );
      const imp = await api<{ ok: boolean; ingestionId: number }>(s.base, 'POST', '/api/import/amazon/report', {
        file_path: csvPath,
        report_type: 'business',
      });
      assert.equal(imp.status, 201, `Amazon 报表导入应成功（${JSON.stringify(imp.data)}）`);
      const detail = await api<{ records: Array<{ raw_payload: string }> }>(s.base, 'GET', `/api/imports/${imp.data.ingestionId}`);
      const payload = detail.data.records[0]?.raw_payload ?? '';
      assert.ok(payload.includes('B0TESTE001'), 'raw 记录必须保留原始 ASIN');
      assert.ok(!/unitsOrdered"\s*:\s*0/.test(payload), `缺失字段不得被补成 0（实际 payload: ${payload.slice(0, 300)}）`);
      assert.ok(/"unitsOrdered"\s*:\s*""/.test(payload), '缺失字段必须原样保留为空值（null 语义）');

      // 缺失项写入 missing_data_items（entity_type=raw_ingestion）
      const missing = await api<Array<{ entity_type: string; field: string }>>(s.base, 'GET', '/api/missing-data');
      assert.ok(
        missing.data.some((x) => x.entity_type === 'raw_ingestion' && x.field === 'units'),
        `Amazon 缺失字段必须记入 missing_data_items，实际: ${JSON.stringify(missing.data.slice(0, 5))}`
      );
    } finally {
      await stopServer(s);
    }
  });
});

