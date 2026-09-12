/**
 * Evidence Engine（V2 §35-36, §62）
 * 所有 AI 重要结论必须落到 Evidence；Insight 引用的 Evidence 必须真实存在
 */
import { getDatabase } from '../../db/connection.js';
import type { Evidence } from '../../types/models.js';

export interface CreateEvidenceInput {
  research_job_id?: number | null;
  insight_id?: number | null;
  claim: string;
  metric_name: string;
  metric_value: number;
  source: string;
  source_record_id?: string | null;
  collected_at?: string;
  calculation?: string | null;
  confidence?: number;
}

export function createEvidence(input: CreateEvidenceInput): Evidence {
  const db = getDatabase();
  const res = db
    .prepare(
      `INSERT INTO evidence (research_job_id, insight_id, claim, metric_name, metric_value, source, source_record_id, collected_at, calculation, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.research_job_id ?? null,
      input.insight_id ?? null,
      input.claim,
      input.metric_name,
      input.metric_value,
      input.source,
      input.source_record_id ?? null,
      input.collected_at ?? new Date().toISOString(),
      input.calculation ?? null,
      input.confidence ?? 1,
      new Date().toISOString()
    );
  return getEvidence(Number(res.lastInsertRowid))!;
}

export function getEvidence(id: number): Evidence | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);
  return row ? (row as unknown as Evidence) : null;
}

export function listEvidenceByInsight(insightId: number): Evidence[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM evidence WHERE insight_id = ? ORDER BY id')
    .all(insightId) as unknown as Evidence[];
}

export function listEvidenceByJob(jobId: number): Evidence[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM evidence WHERE research_job_id = ? ORDER BY id')
    .all(jobId) as unknown as Evidence[];
}

/** 校验：Insight 声明的 evidence_ids 是否全部真实存在（V2 §62 Evidence 测试） */
export function assertEvidenceIntegrity(insightId: number, evidenceIds: number[]): { ok: boolean; missing: number[] } {
  const existing = new Set(listEvidenceByInsight(insightId).map((e) => e.id));
  const missing = evidenceIds.filter((id) => !existing.has(id));
  return { ok: missing.length === 0, missing };
}

export function countEvidence(): number {
  const db = getDatabase();
  return (db.prepare('SELECT COUNT(*) AS c FROM evidence').get() as { c: number }).c;
}
