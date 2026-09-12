/**
 * V2.1 API（真实数据优先）
 * 模式 / Provider 状态与能力矩阵 / 真实导入 / 对账 / 校准 / Evidence trace / 覆盖度 / Owned Products
 */
import { Router, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { getDatabase } from '../db/connection.js';
import { getMode, setMode, modeLabel, type SystemMode } from '../config/mode.js';
import { providerRegistry } from '../adapters/providers/registry.js';
import { importReverseAsinFile } from '../adapters/providers/import-engine.js';
import { amazonImport } from '../adapters/providers/amazon-import.js';
import { buildEvidenceTrace } from '../modules/evidence/trace.js';
import {
  computeCalibration,
  getCalibration,
  recordSourceConflict,
} from '../modules/calibration/engine.js';
import {
  reconcileKeywordIngestion,
  summarizeReconciliation,
  mappingAccuracy,
  computeDataCompleteness,
} from '../modules/reconciliation/engine.js';
import { listEvidenceByJob } from '../modules/evidence/engine.js';
import { getDataPlan } from '../modules/plans/engine.js';

export const api21 = Router();

api21.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ===== 系统模式（§7）=====
api21.get('/system/mode', (_req, res) => {
  const mode = getMode();
  res.json({ mode, label: modeLabel(mode), modes: ['DEMO', 'REAL', 'HYBRID'] });
});

api21.post('/system/mode', (req, res) => {
  const { mode } = (req.body ?? {}) as { mode?: string };
  if (!mode || !['DEMO', 'REAL', 'HYBRID'].includes(mode)) {
    res.status(400).json({ error: 'mode 必须是 DEMO / REAL / HYBRID' });
    return;
  }
  const m = setMode(mode as SystemMode);
  providerRegistry.syncStatusToDb();
  res.json({ mode: m, label: modeLabel(m) });
});

// ===== Provider 状态（§14）与能力矩阵（§4）=====
api21.get('/providers/status', (_req, res) => {
  providerRegistry.syncStatusToDb();
  res.json({ mode: getMode(), providers: providerRegistry.listStatus() });
});

api21.get('/providers/capabilities', (_req, res) => {
  providerRegistry.syncStatusToDb();
  res.json({
    mode: getMode(),
    matrix: providerRegistry.capabilityMatrix(),
    providers: providerRegistry.listStatus(),
  });
});

// ===== 真实导入（P0-1：SellerSprite ReverseASIN 文件）=====
api21.post('/import/sellersprite/reverse-asin', async (req, res) => {
  const { file_path, marketplace, asin, mode } = (req.body ?? {}) as {
    file_path?: string; marketplace?: string; asin?: string; mode?: SystemMode;
  };
  if (!file_path || !existsSync(file_path)) {
    res.status(400).json({ error: 'file_path 不存在，请提供真实文件路径' });
    return;
  }
  const m = mode && ['DEMO', 'REAL', 'HYBRID'].includes(mode) ? (mode as SystemMode) : getMode();
  try {
    const result = await importReverseAsinFile(file_path, {
      marketplace: marketplace ?? 'US',
      asin: asin ?? 'UNKNOWN',
      mode: m,
    });
    providerRegistry.syncStatusToDb();
    res.status(201).json({ ok: true, ...result, note: '原始数据已保留在 raw_ingestions / raw_records' });
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ===== Amazon 报表导入边界（P0-5）=====
api21.post('/import/amazon/report', async (req, res) => {
  const { file_path, report_type, marketplace, mode } = (req.body ?? {}) as {
    file_path?: string; report_type?: string; marketplace?: string; mode?: SystemMode;
  };
  if (!file_path || !existsSync(file_path)) {
    res.status(400).json({ error: 'file_path 不存在' });
    return;
  }
  const validTypes = ['business', 'advertising', 'inventory', 'search_term', 'settlement'];
  if (!report_type || !validTypes.includes(report_type)) {
    res.status(400).json({ error: `report_type 必须是 ${validTypes.join('/')}` });
    return;
  }
  const m = mode && ['DEMO', 'REAL', 'HYBRID'].includes(mode) ? (mode as SystemMode) : getMode();
  try {
    const result = await amazonImport.importReport(file_path, {
      reportType: report_type as 'business',
      marketplace: marketplace ?? 'US',
      mode: m,
    });
    providerRegistry.syncStatusToDb();
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ===== 导入批次查询（raw_ingestions / raw_records）=====
api21.get('/imports', (_req, res) => {
  const db = getDatabase();
  res.json(db.prepare('SELECT * FROM raw_ingestions ORDER BY id DESC LIMIT 100').all());
});

api21.get('/imports/:id', (req, res) => {
  const db = getDatabase();
  const id = Number(req.params.id);
  const ingestion = db.prepare('SELECT * FROM raw_ingestions WHERE id = ?').get(id);
  if (!ingestion) {
    res.status(404).json({ error: '导入批次不存在' });
    return;
  }
  const records = db.prepare('SELECT id, row_index, source_record_id, record_type, raw_payload FROM raw_records WHERE ingestion_id = ? ORDER BY row_index LIMIT 200').all(id);
  const reconcile = summarizeReconciliation(id);
  res.json({ ...ingestion, records, reconciliation: reconcile });
});

// ===== Mapping Queue（§40）=====
api21.get('/mapping-queue', (_req, res) => {
  const db = getDatabase();
  res.json(db.prepare("SELECT * FROM mapping_queue WHERE status = 'pending' ORDER BY id").all());
});

api21.post('/mapping-queue/:id/resolve', (req, res) => {
  const db = getDatabase();
  const id = Number(req.params.id);
  const { standard_field } = (req.body ?? {}) as { standard_field?: string };
  const item = db.prepare('SELECT * FROM mapping_queue WHERE id = ?').get(id) as { source: string; source_column: string } | undefined;
  if (!item) {
    res.status(404).json({ error: 'Mapping Queue 项不存在' });
    return;
  }
  if (!standard_field) {
    res.status(400).json({ error: 'standard_field 必填' });
    return;
  }
  const now = new Date().toISOString();
  const m = db
    .prepare(
      `INSERT INTO normalization_mappings (source, source_type, source_column, standard_field, transform_formula, unit_conversion, lossy, notes, created_at)
       VALUES (?, 'mapping_queue', ?, ?, 'cleanCell', NULL, 1, 'Mapping Queue 人工解析', ?)
       ON CONFLICT(source, source_type, source_column) DO UPDATE SET standard_field = excluded.standard_field`
    )
    .run(item.source, item.source_column, standard_field, now);
  db.prepare("UPDATE mapping_queue SET status = 'resolved', resolved_mapping_id = ?, suggested_field = ? WHERE id = ?").run(Number(m.lastInsertRowid), standard_field, id);
  res.json({ ok: true, mapping_id: Number(m.lastInsertRowid) });
});

// ===== Data Reconciliation（§11 / P0-10）=====
api21.post('/reconciliation/run', (req, res) => {
  const { ingestion_id } = (req.body ?? {}) as { ingestion_id?: number };
  if (!ingestion_id) {
    res.status(400).json({ error: 'ingestion_id 必填' });
    return;
  }
  try {
    const fields = [
      { field: 'search_volume', column: '月搜索量' },
      { field: 'product_count', column: '商品数' },
      { field: 'aba_weekly_rank', column: 'ABA周排名' },
      { field: 'clicks', column: '点击量' },
      { field: 'impressions', column: '展示量' },
    ];
    const summary: Record<string, ReturnType<typeof summarizeReconciliation>> = {};
    const total: Record<'MATCH' | 'DIFFERENT' | 'MISSING' | 'TRANSFORMED', number> = { MATCH: 0, DIFFERENT: 0, MISSING: 0, TRANSFORMED: 0 };
    for (const f of fields) {
      reconcileKeywordIngestion(ingestion_id, f.field, f.column);
      const s = summarizeReconciliation(ingestion_id, f.field);
      summary[f.field] = s;
      for (const k of Object.keys(total) as Array<'MATCH' | 'DIFFERENT' | 'MISSING' | 'TRANSFORMED'>) total[k] += s[k];
    }
    const acc = mappingAccuracy(ingestion_id, ['search_volume', 'product_count']);
    res.json({ ok: true, ingestion_id, by_field: summary, total, mapping_accuracy: acc });
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ===== 第三方估算校准（§22）=====
api21.post('/calibration/run', (req, res) => {
  const { provider, metric, pairs, window_days } = (req.body ?? {}) as {
    provider?: string; metric?: string; pairs?: Array<{ actual: number; estimated: number }>; window_days?: number;
  };
  if (!provider || !metric || !Array.isArray(pairs) || pairs.length === 0) {
    res.status(400).json({ error: 'provider / metric / pairs(≥1) 必填' });
    return;
  }
  try {
    const result = computeCalibration(provider, metric, pairs, window_days ?? 30);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

api21.get('/calibration', (_req, res) => {
  const db = getDatabase();
  res.json(db.prepare('SELECT * FROM calibration_stats ORDER BY id DESC LIMIT 50').all());
});

// ===== Source Conflict（§21）=====
api21.get('/conflicts', (_req, res) => {
  const db = getDatabase();
  res.json(db.prepare("SELECT * FROM source_conflicts WHERE resolution = 'unresolved' ORDER BY id DESC LIMIT 100").all());
});

api21.post('/conflicts', (req, res) => {
  const { entity_type, entity_id, metric, source_a, value_a, source_b, value_b } = (req.body ?? {}) as {
    entity_type?: string; entity_id?: number; metric?: string;
    source_a?: string; value_a?: number; source_b?: string; value_b?: number;
  };
  if (!entity_type || !entity_id || !metric || !source_a || !source_b || value_a === undefined || value_b === undefined) {
    res.status(400).json({ error: 'entity_type/entity_id/metric/source_a/value_a/source_b/value_b 必填' });
    return;
  }
  const r = recordSourceConflict({ entityType: entity_type, entityId: entity_id, metric, sourceA: source_a, valueA: value_a, sourceB: source_b, valueB: value_b });
  res.status(201).json({ ok: true, conflict_id: r.id, variance_pct: r.variancePct, display: `Actual: ${value_a} / Estimated: ${value_b} / Variance: ${r.variancePct >= 0 ? '+' : ''}${r.variancePct}%` });
});

// ===== Evidence trace（§23 / P0-7）=====
api21.get('/evidence/:id/trace', (req, res) => {
  const trace = buildEvidenceTrace(Number(req.params.id));
  if (!trace.evidence) {
    res.status(404).json({ error: 'Evidence 不存在' });
    return;
  }
  res.json(trace);
});

// ===== Owned Products 独立 API（§17 / P0-8）=====
api21.post('/owned-products', (req, res) => {
  const { sku, asin, internal_name, title, brand, marketplace, market_node_id, status, keywords } = (req.body ?? {}) as {
    sku?: string; asin?: string; internal_name?: string; title?: string; brand?: string;
    marketplace?: string; market_node_id?: number | null; status?: string; keywords?: string;
  };
  if (!sku || !asin || !internal_name) {
    res.status(400).json({ error: 'sku / asin / internal_name 必填（自有 SKU 独立录入，不走 development-project）' });
    return;
  }
  const db = getDatabase();
  const dup = db.prepare('SELECT id FROM owned_products WHERE sku = ? OR asin = ?').get(sku, asin);
  if (dup) {
    res.status(409).json({ error: `自有产品已存在（sku/asin 重复）: ${JSON.stringify(dup)}` });
    return;
  }
  const now = new Date().toISOString();
  const ins = db
    .prepare(
      `INSERT INTO owned_products (sku, asin, internal_name, title, brand, marketplace, market_id, keywords, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(sku, asin, internal_name, title ?? internal_name, brand ?? '', marketplace ?? 'US', market_node_id ?? null, keywords ?? null, status ?? 'active', now, now);
  const id = Number(ins.lastInsertRowid);
  // 同步创建 products 行（自有标记）
  const p = db.prepare('SELECT id FROM products WHERE asin = ?').get(asin) as { id: number } | undefined;
  if (p) {
    db.prepare('UPDATE products SET is_owned = 1, owned_sku_id = ?, market_id = COALESCE(market_id, ?) WHERE id = ?').run(id, market_node_id ?? null, p.id);
  } else {
    const pi = db
      .prepare('INSERT INTO products (asin, brand, title, marketplace, market_id, is_owned, owned_sku_id, source, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
      .run(asin, brand ?? '', title ?? internal_name, marketplace ?? 'US', market_node_id ?? null, id, 'manual', now);
    void pi;
  }
  res.status(201).json(db.prepare('SELECT * FROM owned_products WHERE id = ?').get(id));
});

// ===== 真实数据覆盖度 Dashboard（§42）=====
api21.get('/dashboard/coverage', (_req, res) => {
  const db = getDatabase();
  const mode = getMode();
  const rawCount = (db.prepare("SELECT COUNT(*) AS n FROM raw_ingestions WHERE source = 'sellersprite'").get() as { n: number }).n;
  const amazonRawCount = (db.prepare("SELECT COUNT(*) AS n FROM raw_ingestions WHERE source = 'amazon'").get() as { n: number }).n;
  const ownedCount = (db.prepare('SELECT COUNT(*) AS n FROM owned_products').get() as { n: number }).n;
  const snapshots = (db.prepare('SELECT COUNT(*) AS n FROM keyword_snapshots WHERE provenance != ?').get('MOCK') as { n: number }).n;
  const adCount = (db.prepare("SELECT COUNT(*) AS n FROM raw_ingestions WHERE source = 'amazon' AND source_type = 'advertising'").get() as { n: number }).n;
  res.json({
    mode,
    coverage: {
      market: rawCount > 0 ? { status: 'ESTIMATED', detail: `SellerSprite 导入批次 ${rawCount}` } : { status: 'MISSING', detail: '未导入 SellerSprite 文件' },
      owned_sales: amazonRawCount > 0 ? { status: 'AMAZON_ACTUAL', detail: 'Amazon 报表已导入' } : { status: 'MISSING', detail: '未导入 Amazon 报表 / 未授权 SP-API' },
      competitor_sales: snapshots > 0 ? { status: 'ESTIMATED', detail: `${snapshots} 条 SellerSprite 关键词快照` } : { status: 'MISSING', detail: '无竞品估算数据' },
      ads: adCount > 0 ? { status: 'PARTIAL', detail: '广告报表已导入' } : { status: 'MISSING', detail: 'Ads 未授权/未导入' },
      supply_chain: { status: ownedCount > 0 ? 'PARTIAL' : 'MISSING', detail: `${ownedCount} 个自有 SKU（成本未录入）` },
    },
  });
});

// ===== Data Plan / Completeness（§5 / §43）=====
api21.get('/jobs/:id/data-plan', (req, res) => {
  const plan = getDataPlan(Number(req.params.id));
  if (!plan) {
    res.status(404).json({ error: '该任务尚未生成 Data Plan（未运行）' });
    return;
  }
  const completeness = computeDataCompleteness(Number(req.params.id));
  res.json({ ...plan, completeness });
});

// ===== Evidence 列表（trace 入口辅助）=====
api21.get('/jobs/:id/evidence', (req, res) => {
  res.json(listEvidenceByJob(Number(req.params.id)));
});
