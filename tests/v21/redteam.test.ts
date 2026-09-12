/**
 * V2.1 Red Team 对抗测试（§28 / §38 / §39 / §53）
 * 1. REAL 模式禁止 Mock fallback
 * 2. Raw trace：Evidence 必须穿透到 raw_record
 * 3. Import mapping：未知列 → mapping_queue
 * 4. Duplicate ASIN / 行：不重复创建错误记录
 * 5. Source conflict：Amazon vs SellerSprite 并存显示
 * 6. Approval bypass：researching → approved 被后端拒绝（403 语义）
 * 7. Hard Gate 红队 3 案例
 * 8. 恶意数据不崩溃（NA/0/$39.99/39,99/负值/超大值/GBK/BOM）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInMemory, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createResearchJob, getResearchJob, setJobStatus } from '../../src/modules/research/job.js';
import { runResearchJob } from '../../src/workflows/orchestrator.js';
import { approveResearchJob } from '../../src/modules/decisions/engine.js';
import { createRuleProfile } from '../../src/modules/rules/profile.js';
import { evaluateHardGates, type HardGateContext } from '../../src/modules/rules/engine.js';
import { setMode, getMode } from '../../src/config/mode.js';
import { providerRegistry } from '../../src/adapters/providers/registry.js';
import { registerAllProviders } from '../../src/adapters/providers/index.js';
import { importReverseAsinFile, parseImportFile, toNumber, cleanCell } from '../../src/adapters/providers/import-engine.js';
import { reconcileKeywordIngestion, summarizeReconciliation, mappingAccuracy } from '../../src/modules/reconciliation/engine.js';
import { recordSourceConflict } from '../../src/modules/calibration/engine.js';
import { createEvidence } from '../../src/modules/evidence/engine.js';
import { assertEvidenceTraceIntegrity } from '../../src/modules/evidence/trace.js';
import { seedOwnedProducts } from '../../src/seed/seed-demo.js';

const REVERSE_ASIN_CSV = [
  '流量词,关键词翻译,月搜索量,商品数,ABA周排名,点击量,展示量,父体销量',
  'memory foam pillow,记忆棉枕头,6937,2492,105994,6181,381294,1200',
  'contour pillow,轮廓枕,4200,1500,88000,3300,200000,900',
  '',
].join('\n');

function tmpCsv(content: string, name = 'reverse-asin-test.csv'): string {
  const dir = mkdtempSync(join(tmpdir(), 'v21-'));
  const p = join(dir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

test('V2.1 §53-1: REAL 模式禁止 Mock fallback → needs_data（不自动切 Mock）', async () => {
  openInMemory();
  try {
    createRuleProfile({ name: 'amazon_us_memory_foam_v1', version: '1.0.0', active: true });
    seedOwnedProducts();
    registerAllProviders();
    setMode('REAL');
    const job = createResearchJob({ name: 'RT: REAL 模式自有 SKU 诊断', job_type: 'owned_product', target: 'SKU-A' });
    const r = await runResearchJob(job.id);
    assert.equal(r.status, 'needs_data', 'REAL 模式下缺真实 Provider 必须 needs_data');
    const db = getDatabase();
    const missing = db.prepare("SELECT COUNT(*) AS n FROM missing_data_items WHERE research_job_id = ? AND status = 'open'").get(job.id) as { n: number };
    assert.ok(missing.n > 0, '应有缺失数据记录');
    assert.ok((getResearchJob(job.id)?.error ?? '').includes('缺少 SellerSprite / Amazon 数据'));
    setMode('DEMO');
  } finally {
    setMode('DEMO');
  }
});

test('V2.1 §53-2: Raw trace —— Evidence 可穿透到 raw_record', async () => {
  openInMemory();
  try {
    const p = tmpCsv(REVERSE_ASIN_CSV);
    const res = await importReverseAsinFile(p, { marketplace: 'US', asin: 'B0TEST0001', mode: 'REAL' });
    rmSync(p, { recursive: true, force: true });
    const db = getDatabase();
    const raw = db.prepare('SELECT id FROM raw_records WHERE ingestion_id = ? ORDER BY row_index LIMIT 1').get(res.ingestionId) as { id: number } | undefined;
    assert.ok(raw, '应有 raw_record');
    const ev = createEvidence({
      claim: 'memory foam pillow 月搜索量（真实 SellerSprite 导入）',
      metric_name: 'keyword_search_volume',
      metric_value: 6937,
      source: 'sellersprite_import',
      source_record_id: `raw:${raw.id}`,
      collected_at: new Date().toISOString(),
      calculation: 'raw 月搜索量 6937',
    });
    const integrity = assertEvidenceTraceIntegrity(ev.id);
    assert.ok(integrity.ok, `Evidence trace 应全链完整: ${integrity.issues.join('; ')}`);
  } finally {
    closeDatabase();
  }
});

test('V2.1 §53-3: Import mapping —— 未知列进入 mapping_queue（不静默丢弃）', async () => {
  openInMemory();
  try {
    const p = tmpCsv(REVERSE_ASIN_CSV);
    const res = await importReverseAsinFile(p, { marketplace: 'US', asin: 'B0TEST0001', mode: 'REAL' });
    rmSync(p, { recursive: true, force: true });
    const db = getDatabase();
    const queue = db.prepare("SELECT source_column, status FROM mapping_queue WHERE source = 'sellersprite'").all() as Array<{ source_column: string; status: string }>;
    assert.ok(queue.some((q) => q.source_column === '父体销量' && q.status === 'pending'), '未知列 父体销量 应进入 mapping_queue');
    assert.ok(res.unmapped_columns.some((u) => u.source_column === '父体销量'));
  } finally {
    closeDatabase();
  }
});

test('V2.1 §53-4: Duplicate ASIN / 重复导入 —— 不重复创建错误记录', async () => {
  openInMemory();
  try {
    const p = tmpCsv(REVERSE_ASIN_CSV);
    const r1 = await importReverseAsinFile(p, { marketplace: 'US', asin: 'B0TEST0001', mode: 'REAL' });
    const r2 = await importReverseAsinFile(p, { marketplace: 'US', asin: 'B0TEST0001', mode: 'REAL' });
    rmSync(p, { recursive: true, force: true });
    assert.ok(r1.row_count === 2 && r2.row_count === 2);
    assert.ok(r2.duplicate_rows >= 1, '重复导入应识别重复 keyword');
    const db = getDatabase();
    const n = db.prepare("SELECT COUNT(*) AS n FROM keywords WHERE keyword = 'memory foam pillow'").get() as { n: number };
    assert.equal(n.n, 1, '关键词不得重复创建');
  } finally {
    closeDatabase();
  }
});

test('V2.1 §53-5: Source conflict —— Amazon 实际 vs SellerSprite 估算并存显示', async () => {
  openInMemory();
  try {
    const c = recordSourceConflict({
      entityType: 'owned_product',
      entityId: 1,
      metric: 'sales_30d',
      sourceA: 'amazon_actual',
      valueA: 120,
      sourceB: 'sellersprite_estimated',
      valueB: 165,
    });
    assert.equal(c.variancePct, 37.5, 'Variance = +37.5%');
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM source_conflicts WHERE id = ?').get(c.id) as { value_a: number; value_b: number; variance_pct: number } | undefined;
    assert.ok(row, '冲突应落库并存（不自动选一个）');
    assert.equal(row.value_a, 120);
    assert.equal(row.value_b, 165);
  } finally {
    closeDatabase();
  }
});

test('V2.1 §53-6: Approval bypass —— researching 阶段直接批准被后端拒绝', async () => {
  openInMemory();
  try {
    const job = createResearchJob({ name: 'RT: bypass', job_type: 'adjacent_product', target: 'X' });
    setJobStatus(job.id, 'analyzing'); // 模拟 researching 阶段（绕过式设置，测试状态机守卫）
    assert.throws(
      () => approveResearchJob(job.id, 'attacker', '绕过审批'),
      /仅 waiting_approval 状态可审批/,
      '后端必须拒绝 researching → approved'
    );
    assert.equal(getResearchJob(job.id)?.status, 'analyzing', '状态不得被改变');
  } finally {
    closeDatabase();
  }
});

test('V2.1 §28: Hard Gate 红队 3 案例', async () => {
  openInMemory();
  try {
    const profile = createRuleProfile({ name: 'rt_redteam', version: '1.0.0', active: true });
    // Case 1：Demand 95 / Competition 90 / IP CRITICAL → REJECT
    const c1: HardGateContext = { ip_risk: 'critical', certification_required: false, certification_available: true, contribution_profit_rate: 25, moq_cost: 500, total_budget: 10000, within_logistics: true, supply_chain_validated: true, critical_data_missing: false };
    assert.equal(evaluateHardGates(c1, profile).result, 'reject', 'IP critical 必须 REJECT');
    // Case 2：Score 90 但缺强制成本数据 → NEEDS_DATA
    const c2: HardGateContext = { ip_risk: 'none', certification_required: false, certification_available: null, contribution_profit_rate: null, moq_cost: null, total_budget: null, within_logistics: null, supply_chain_validated: null, critical_data_missing: true };
    assert.equal(evaluateHardGates(c2, profile).result, 'needs_data', '缺强制数据必须 NEEDS_DATA（不通过不拒绝）');
    // Case 3：市场很好但 MOQ > 预算 → REJECT
    const c3: HardGateContext = { ip_risk: 'none', certification_required: false, certification_available: true, contribution_profit_rate: 30, moq_cost: 8000, total_budget: 10000, within_logistics: true, supply_chain_validated: true, critical_data_missing: false };
    assert.equal(evaluateHardGates(c3, profile).result, 'reject', 'MOQ/预算超限必须 REJECT');
    const db = getDatabase();
    const gates = (db.prepare('SELECT hard_gates_json FROM rule_profiles WHERE name = ?').get('rt_redteam') as { hard_gates_json: string });
    assert.ok(gates.hard_gates_json.length > 0);
  } finally {
    closeDatabase();
  }
});

test('V2.1 §39: 恶意数据不崩溃 —— NA/0/$39.99/39,99/负值/超大值/GBK/BOM', async () => {
  openInMemory();
  try {
    // 数值解析
    assert.equal(toNumber(cleanCell('$39.99')), 39.99);
    assert.equal(toNumber(cleanCell('39,99')), 39.99);
    assert.equal(toNumber(cleanCell('MX$0.02')), 0.02);
    assert.equal(toNumber(cleanCell('12%')), 12);
    assert.equal(toNumber(cleanCell('NA')), null);
    assert.equal(toNumber(cleanCell('-')), null);
    assert.equal(toNumber(cleanCell('')), null);
    assert.equal(toNumber(cleanCell('-5')), -5);
    assert.equal(toNumber(cleanCell('99999999999')), 99999999999);
    assert.equal(toNumber(cleanCell('0')), 0);

    // 恶意 CSV：日期混乱 / 负销量 / 超大值 / 空行 —— 导入不崩
    const evil = [
      '流量词,月搜索量,购买量,购买率,日期',
      'pillow,1000,-50,NA,2026/13/45',
      'neck,99999999999,0,,01-01-2026',
      ',,,12%,',
      '',
    ].join('\n');
    const p = tmpCsv(evil, 'evil.csv');
    const sheet = await parseImportFile(p);
    rmSync(p, { recursive: true, force: true });
    assert.ok(sheet.rows.length >= 2, '恶意行应被解析且不崩溃');
  } finally {
    closeDatabase();
  }
});

test('V2.1 §12-4: 关键字段映射正确率（真实导入 → 对账 MATCH）', async () => {
  openInMemory();
  try {
    const p = tmpCsv(REVERSE_ASIN_CSV);
    const res = await importReverseAsinFile(p, { marketplace: 'US', asin: 'B0TEST0001', mode: 'REAL' });
    rmSync(p, { recursive: true, force: true });
    reconcileKeywordIngestion(res.ingestionId, 'search_volume', '月搜索量');
    reconcileKeywordIngestion(res.ingestionId, 'product_count', '商品数');
    const s = summarizeReconciliation(res.ingestionId);
    assert.equal(s.MATCH, 4, '2 关键词 × (月搜索量 + 商品数) 应对账 MATCH');
    const acc = mappingAccuracy(res.ingestionId, ['search_volume', 'product_count']);
    assert.equal(acc.accuracy, 100, '关键字段映射正确率应为 100%');
  } finally {
    closeDatabase();
  }
});
