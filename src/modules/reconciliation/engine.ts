/**
 * Data Reconciliation（V2.1 §11）——原始行 vs 标准化数据库 抽查
 * 输出 MATCH / DIFFERENT / MISSING / TRANSFORMED
 */
import { getDatabase } from '../../db/connection.js';
import { cleanCell, toNumber } from '../../adapters/providers/import-engine.js';

export type ReconcileOutcome = 'MATCH' | 'DIFFERENT' | 'MISSING' | 'TRANSFORMED';

export interface ReconcileRow {
  ingestionId: number;
  sourceRecordId: string | null;
  field: string;
  rawValue: string | null;
  dbValue: string | null;
  outcome: ReconcileOutcome;
  transformNote: string | null;
}

/**
 * 对 ReverseASIN 导入的关键词快照做对账。
 * field ∈ { search_volume, product_count, aba_weekly_rank, clicks, impressions }
 * raw 值取原始行对应列（清洗/数值化前），db 值取 keyword_snapshots 最新快照。
 */
export function reconcileKeywordIngestion(ingestionId: number, field: string, rawColumn: string): ReconcileRow[] {
  const db = getDatabase();
  const rawRows = db.prepare('SELECT id, row_index, source_record_id, raw_payload FROM raw_records WHERE ingestion_id = ? ORDER BY row_index').all(ingestionId) as
    Array<{ id: number; source_record_id: string | null; raw_payload: string }>;
  // keyword_snapshots 无 product_count 列：商品数 → competing_products
  const dbColumn = field === 'product_count' ? 'competing_products' : field;
  const out: ReconcileRow[] = [];
  const findSnapshot = db.prepare(
    `SELECT s.${dbColumn} AS val FROM keyword_snapshots s
     JOIN keywords k ON k.id = s.keyword_id
     WHERE k.keyword = ? AND k.marketplace = ? ORDER BY s.id DESC LIMIT 1`
  );
  for (const rr of rawRows) {
    const p = JSON.parse(rr.raw_payload) as Record<string, string>;
    const keyword = cleanCell(p['流量词'] ?? '');
    const marketplace = p['marketplace'] ?? 'US';
    const rawValue = cleanCell(p[rawColumn] ?? '');
    if (!keyword) continue;
    const dbRow = findSnapshot.get(keyword, marketplace) as { val: number | null } | undefined;
    const dbVal = dbRow?.val ?? null;
    let outcome: ReconcileOutcome;
    let note: string | null = null;
    if (rawValue === null) {
      outcome = dbVal === null ? 'MISSING' : 'MISSING';
      note = '原始值为空';
    } else {
      const rawNum = toNumber(rawValue);
      if (rawNum === null) {
        outcome = 'TRANSFORMED';
        note = `原始值 "${rawValue}" 无法数值化，按原样保留`;
      } else if (dbVal === null) {
        outcome = 'MISSING';
        note = '标准库无对应快照';
      } else if (Math.abs(rawNum - dbVal) < 0.0001) {
        outcome = 'MATCH';
      } else {
        outcome = 'DIFFERENT';
        note = `raw=${rawNum} db=${dbVal} diff=${(dbVal - rawNum).toFixed(2)}`;
      }
    }
    out.push({
      ingestionId,
      sourceRecordId: rr.source_record_id,
      field,
      rawValue: rawValue ?? null,
      dbValue: dbVal === null ? null : String(dbVal),
      outcome,
      transformNote: note,
    });
  }
  // 幂等：重跑对账前先清该批次该字段的旧结果（避免重复累计，不影响其他字段）
  db.prepare('DELETE FROM reconciliation_results WHERE ingestion_id = ? AND field = ?').run(ingestionId, field);
  // 落库
  const ins = db.prepare(
    `INSERT INTO reconciliation_results (ingestion_id, entity_type, source_record_id, field, raw_value, db_value, outcome, transform_note, created_at)
     VALUES (?, 'keyword', ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = new Date().toISOString();
  for (const r of out) {
    ins.run(r.ingestionId, r.sourceRecordId, r.field, r.rawValue, r.dbValue, r.outcome, r.transformNote, now);
  }
  return out;
}

/** 汇总某次导入的对账统计（可按字段过滤；缺省统计该批次全部字段） */
export function summarizeReconciliation(ingestionId: number, field?: string): Record<ReconcileOutcome, number> {
  const db = getDatabase();
  const base: Record<ReconcileOutcome, number> = { MATCH: 0, DIFFERENT: 0, MISSING: 0, TRANSFORMED: 0 };
  const rows = (field
    ? db.prepare('SELECT outcome, COUNT(*) AS n FROM reconciliation_results WHERE ingestion_id = ? AND field = ? GROUP BY outcome').all(ingestionId, field)
    : db.prepare('SELECT outcome, COUNT(*) AS n FROM reconciliation_results WHERE ingestion_id = ? GROUP BY outcome').all(ingestionId)
  ) as Array<{ outcome: ReconcileOutcome; n: number }>;
  for (const r of rows) base[r.outcome] = r.n;
  return base;
}

/** 关键字段映射正确率（V2.1 §12 测试4）
 *  正确率 = 映射一致 / 有值条目（MISSING 是源数据缺失，不算映射错误）；
 *  checked 返回检查总条数（含 MISSING）供审计。 */
export function mappingAccuracy(ingestionId: number, fields: string[]): { fields: number; checked: number; match: number; missing: number; accuracy: number } {
  let checked = 0;
  let match = 0;
  let missing = 0;
  for (const f of fields) {
    const rows = dbGetReconcile(ingestionId, f);
    checked += rows.length;
    match += rows.filter((r) => r.outcome === 'MATCH' || r.outcome === 'TRANSFORMED').length;
    missing += rows.filter((r) => r.outcome === 'MISSING').length;
  }
  const judged = checked - missing; // 有值条目（可判映射对错）
  return { fields: fields.length, checked, match, missing, accuracy: judged === 0 ? 0 : Math.round((match / judged) * 1000) / 10 };
}

function dbGetReconcile(ingestionId: number, field: string): ReconcileRow[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT source_record_id, field, raw_value, db_value, outcome, transform_note FROM reconciliation_results WHERE ingestion_id = ? AND field = ?')
    .all(ingestionId, field) as Array<{ source_record_id: string | null; field: string; raw_value: string | null; db_value: string | null; outcome: ReconcileOutcome; transform_note: string | null }>;
  return rows.map((r) => ({
    ingestionId,
    sourceRecordId: r.source_record_id,
    field: r.field,
    rawValue: r.raw_value,
    dbValue: r.db_value,
    outcome: r.outcome,
    transformNote: r.transform_note,
  }));
}

/** Data Completeness（V2.1 §43）——按 Data Plan 已覆盖的 required/optional 计算 */
export function computeDataCompleteness(jobId: number): { score: number; covered: string[]; missing: string[] } {
  const db = getDatabase();
  const plan = db.prepare('SELECT required_json, optional_json FROM data_plans WHERE research_job_id = ? ORDER BY id DESC LIMIT 1').get(jobId) as
    | { required_json: string; optional_json: string }
    | undefined;
  if (!plan) return { score: 0, covered: [], missing: [] };
  const required = JSON.parse(plan.required_json) as string[];
  const optional = JSON.parse(plan.optional_json) as string[];
  const evidenceFields = db
    .prepare('SELECT DISTINCT metric_name FROM evidence WHERE research_job_id = ?')
    .all(jobId) as Array<{ metric_name: string }>;
  const coveredSet = new Set(evidenceFields.map((e) => e.metric_name));
  const coveredRequired = required.filter((c) => coveredSet.has(c));
  const coveredOptional = optional.filter((c) => coveredSet.has(c));
  const score = Math.round(((coveredRequired.length + coveredOptional.length * 0.5) / (required.length + optional.length * 0.5 || 1)) * 100);
  return { score, covered: [...coveredRequired, ...coveredOptional], missing: required.filter((c) => !coveredSet.has(c)) };
}
