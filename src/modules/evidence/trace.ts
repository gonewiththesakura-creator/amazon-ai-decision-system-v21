/**
 * Evidence V2.1 追溯（§8 / §23 / §24）
 * 链路：Raw Source → Raw Record → Normalization → Snapshot → Metric → Rule → Insight → Decision
 * assertEvidenceTraceIntegrity：全链存在性 + 时间一致 + entity 一致
 * source_record_id 约定：'raw:<id>' → raw_records.id；'snap:<table>:<id>' → 快照 id；'kws:<id>' → keyword_snapshots.id
 */
import { getDatabase } from '../../db/connection.js';
import { getEvidence } from './engine.js';
import { providerRegistry } from '../../adapters/providers/registry.js';

export interface EvidenceTrace {
  evidence: Record<string, unknown> | null;
  metric: { name: string; value: number | null; calculation: string | null } | null;
  snapshot: Record<string, unknown> | null;
  normalized: Record<string, unknown> | null;
  rawRecord: Record<string, unknown> | null;
  rawIngestion: Record<string, unknown> | null;
  source: Record<string, unknown> | null;
  insight: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  integrity: { ok: boolean; issues: string[] };
}

function findSnapshotForEvidence(evidence: { metric_name: string; source_record_id: string | null }): { table: string; row: Record<string, unknown> } | null {
  const db = getDatabase();
  const src = evidence.source_record_id ?? '';
  const m = src.match(/^snap:(\w+):(\d+)$/);
  if (m && m[1] && m[2]) {
    const row = db.prepare(`SELECT * FROM ${m[1]} WHERE id = ?`).get(Number(m[2])) as Record<string, unknown> | undefined;
    if (row) return { table: m[1], row };
  }
  const km = src.match(/^kws:(\d+)$/);
  if (km) {
    const row = db.prepare('SELECT * FROM keyword_snapshots WHERE id = ?').get(Number(km[1])) as Record<string, unknown> | undefined;
    if (row) return { table: 'keyword_snapshots', row };
  }
  // raw:<id>：从 raw payload 提取 keyword，匹配最新 keyword_snapshots
  const rm = src.match(/^raw:(\d+)$/);
  if (rm) {
    const record = db.prepare('SELECT raw_payload FROM raw_records WHERE id = ?').get(Number(rm[1])) as { raw_payload: string } | undefined;
    if (record) {
      const p = JSON.parse(record.raw_payload) as Record<string, string>;
      const keyword = p['流量词'] ?? p['keyword'];
      const marketplace = p['marketplace'] ?? 'US';
      if (keyword) {
        const row = db
          .prepare(
            `SELECT s.* FROM keyword_snapshots s JOIN keywords k ON k.id = s.keyword_id
             WHERE k.keyword = ? AND k.marketplace = ? ORDER BY s.date DESC LIMIT 1`
          )
          .get(keyword, marketplace) as Record<string, unknown> | undefined;
        if (row) return { table: 'keyword_snapshots', row };
      }
    }
  }
  return null;
}

function findRawForEvidence(evidence: { source_record_id: string | null; metric_name: string }): { record: Record<string, unknown>; ingestion: Record<string, unknown> } | null {
  const db = getDatabase();
  const src = evidence.source_record_id ?? '';
  const rm = src.match(/^raw:(\d+)$/);
  if (rm) {
    const record = db.prepare('SELECT * FROM raw_records WHERE id = ?').get(Number(rm[1])) as Record<string, unknown> | undefined;
    if (record) {
      const ingestion = db.prepare('SELECT * FROM raw_ingestions WHERE id = ?').get(record['ingestion_id'] as number) as Record<string, unknown> | undefined;
      return { record, ingestion: ingestion ?? {} };
    }
    return null;
  }
  // 无显式 raw 关联时，尝试按 metric_name 找 keyword 快照来源
  if (evidence.metric_name.startsWith('keyword_')) {
    const rows = db
      .prepare(
        `SELECT rr.*, ri.* FROM raw_records rr JOIN raw_ingestions ri ON ri.id = rr.ingestion_id
         WHERE rr.raw_payload LIKE '%流量词%' ORDER BY rr.id DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;
    if (rows) return { record: rows, ingestion: rows };
  }
  return null;
}

/** 构建 Evidence 全链路 trace */
export function buildEvidenceTrace(evidenceId: number): EvidenceTrace {
  const db = getDatabase();
  const evidence = getEvidence(evidenceId);
  if (!evidence) {
    return {
      evidence: null, metric: null, snapshot: null, normalized: null, rawRecord: null,
      rawIngestion: null, source: null, insight: null, decision: null,
      integrity: { ok: false, issues: ['evidence 不存在'] },
    };
  }
  const ev = evidence as unknown as { metric_name: string; metric_value: number; calculation: string | null; source_record_id: string | null; collected_at: string; insight_id: number | null; research_job_id: number | null; source: string };
  const issues: string[] = [];

  // metric
  const metric = ev.metric_name && ev.metric_value !== null
    ? { name: ev.metric_name, value: ev.metric_value, calculation: ev.calculation ?? null }
    : null;
  if (!metric) issues.push('metric 缺失');

  // snapshot + normalized（normalized 记录 = 快照行本身，已是标准化后的库内记录）
  const snap = findSnapshotForEvidence(ev);
  if (!snap) issues.push('snapshot 缺失（无对应快照关联）');
  const normalized = snap ? snap.row : null;
  if (!normalized) issues.push('normalized record 缺失');

  // raw
  const raw = findRawForEvidence(ev);
  if (!raw) issues.push('raw record 缺失（Evidence 无法穿透到原始数据）');

  // source
  const sourceKnown = providerRegistry.has(ev.source) || ev.source.includes('SellerSprite') || ev.source.includes('Amazon');
  if (!sourceKnown) issues.push('source 未在 Provider Registry 注册');

  // 时间一致：evidence.collected_at >= raw.fetched_at
  if (raw?.ingestion?.['fetched_at']) {
    const fetched = String(raw.ingestion['fetched_at']);
    if (ev.collected_at && ev.collected_at < fetched) {
      issues.push(`时间不一致: evidence(${ev.collected_at}) 早于 raw(${fetched})`);
    }
  }

  // entity 一致：raw 里的 asin/marketplace 与 evidence 语义一致（evidence 无 entity 字段，检查 research_job 目标）
  if (raw?.record?.['raw_payload']) {
    const payload = JSON.parse(String(raw.record['raw_payload'])) as Record<string, string>;
    const job = ev.research_job_id ? (db.prepare('SELECT target, marketplace FROM research_jobs WHERE id = ?').get(ev.research_job_id) as { target: string; marketplace: string } | undefined) : undefined;
    if (job?.target && payload['asin'] && payload['asin'] !== job.target && !job.target.includes(payload['asin'])) {
      issues.push(`entity 不一致: raw asin=${payload['asin']} vs job target=${job.target}`);
    }
  }

  // insight / decision
  const insight = ev.insight_id ? (db.prepare('SELECT * FROM ai_insights WHERE id = ?').get(ev.insight_id) as Record<string, unknown> | undefined ?? null) : null;
  const decision = ev.research_job_id
    ? (db.prepare('SELECT * FROM decisions WHERE research_job_id = ? ORDER BY id DESC LIMIT 1').get(ev.research_job_id) as Record<string, unknown> | undefined ?? null)
    : null;

  return {
    evidence: ev as unknown as Record<string, unknown>,
    metric,
    snapshot: snap?.row ?? null,
    normalized,
    rawRecord: raw?.record ?? null,
    rawIngestion: raw?.ingestion ?? null,
    source: sourceKnown ? { provider: ev.source } : null,
    insight,
    decision,
    integrity: { ok: issues.length === 0, issues },
  };
}

/** V2.1 §24：完整性断言（evidence/metric/snapshot/normalized/raw/source/时间/entity） */
export function assertEvidenceTraceIntegrity(evidenceId: number): { ok: boolean; issues: string[] } {
  return buildEvidenceTrace(evidenceId).integrity;
}
