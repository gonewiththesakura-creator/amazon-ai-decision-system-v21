/**
 * Approval Gate + Decision Log + 机会池（V2 §33-42）
 * 重大业务动作不自动执行；人的决定必须单独落库，禁止只存在聊天文本中
 */
import { getDatabase } from '../../db/connection.js';
import { getResearchJob, transitionJob } from '../research/job.js';
import type { Decision } from '../../types/models.js';

const now = () => new Date().toISOString();

export function recordDecision(params: {
  research_job_id: number;
  entity_type?: string;
  entity_id?: number;
  decision: string;
  reason?: string | null;
  ai_insight_id?: number | null;
  reverse_review_id?: number | null;
  data_version?: string | null;
  decided_by?: string;
  role?: string; // V2.1 §30：Admin / Reviewer
}): Decision {
  const db = getDatabase();
  const res = db
    .prepare(
      `INSERT INTO decisions (research_job_id, entity_type, entity_id, decision, reason, ai_insight_id, reverse_review_id, data_version, decided_by, role, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.research_job_id,
      params.entity_type ?? 'research_job',
      params.entity_id ?? params.research_job_id,
      params.decision,
      params.reason ?? null,
      params.ai_insight_id ?? null,
      params.reverse_review_id ?? null,
      params.data_version ?? null,
      params.decided_by ?? 'human',
      params.role ?? 'Admin',
      now()
    );
  return getDecision(Number(res.lastInsertRowid))!;
}

export function getDecision(id: number): Decision | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
  return row ? (row as unknown as Decision) : null;
}

export function listDecisions(jobId?: number): Decision[] {
  const db = getDatabase();
  const rows = jobId
    ? (db.prepare('SELECT * FROM decisions WHERE research_job_id = ? ORDER BY id DESC').all(jobId) as unknown as Decision[])
    : (db.prepare('SELECT * FROM decisions ORDER BY id DESC LIMIT 200').all() as unknown as Decision[]);
  return rows;
}

/** 审批：批准下一阶段（V2.1 §29：仅 waiting_approval 可审批；analyzing → approved 被状态机禁止） */
export function approveResearchJob(jobId: number, decidedBy = 'human', reason?: string, role = 'Admin'): Decision {
  const job = getResearchJob(jobId);
  if (!job) throw new Error(`ResearchJob ${jobId} 不存在`);
  if (job.status !== 'waiting_approval') throw new Error(`仅 waiting_approval 状态可审批（当前 ${job.status}）`);
  const latestInsight = getLatestInsightForJob(jobId);
  const reverseReview = getLatestReverseReview(jobId);
  const decision = recordDecision({
    research_job_id: jobId,
    entity_type: 'research_job',
    entity_id: jobId,
    decision: 'approved',
    reason: reason ?? null,
    ai_insight_id: latestInsight?.id ?? null,
    reverse_review_id: reverseReview?.id ?? null,
    decided_by: decidedBy,
    role,
  });
  transitionJob(jobId, 'approved');
  return decision;
}

export function watchResearchJob(jobId: number, decidedBy = 'human', reason?: string): Decision {
  const job = getResearchJob(jobId);
  if (!job) throw new Error(`ResearchJob ${jobId} 不存在`);
  if (job.status !== 'waiting_approval' && job.status !== 'needs_data') {
    throw new Error(`当前状态 ${job.status} 不支持继续观察`);
  }
  const decision = recordDecision({
    research_job_id: jobId,
    decision: 'watch',
    reason: reason ?? '继续观察',
    decided_by: decidedBy,
  });
  if (job.status === 'waiting_approval') transitionJob(jobId, 'watch');
  return decision;
}

export function rejectResearchJob(jobId: number, decidedBy = 'human', reason?: string): Decision {
  const job = getResearchJob(jobId);
  if (!job) throw new Error(`ResearchJob ${jobId} 不存在`);
  if (!['waiting_approval', 'reverse_review', 'needs_data'].includes(job.status)) {
    throw new Error(`当前状态 ${job.status} 不支持拒绝`);
  }
  const decision = recordDecision({
    research_job_id: jobId,
    decision: 'rejected',
    reason: reason ?? '人工拒绝',
    decided_by: decidedBy,
  });
  if (job.status !== 'needs_data') transitionJob(jobId, 'rejected');
  return decision;
}

function getLatestInsightForJob(jobId: number): { id: number } | null {
  const db = getDatabase();
  const row = db.prepare('SELECT id FROM ai_insights WHERE research_job_id = ? ORDER BY id DESC LIMIT 1').get(jobId) as { id: number } | undefined;
  return row ?? null;
}

function getLatestReverseReview(jobId: number): { id: number } | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT id FROM ai_insights WHERE research_job_id = ? AND insight_type = 'reverse_review' ORDER BY id DESC LIMIT 1")
    .get(jobId) as { id: number } | undefined;
  return row ?? null;
}

// ===== 机会池 =====

export interface OpportunityRow {
  id: number;
  name: string;
  source_type: string;
  market_id: number | null;
  opportunity_score: number | null;
  hard_gate_status: string | null;
  status: string;
  summary: string | null;
  latest_insight_id: number | null;
  latest_reverse_review_id: number | null;
  last_checked_at: string | null;
  created_at: string;
}

export function listOpportunities(status?: string): OpportunityRow[] {
  const db = getDatabase();
  const rows = status
    ? (db.prepare('SELECT * FROM opportunities WHERE status = ? ORDER BY id DESC').all(status) as unknown as OpportunityRow[])
    : (db.prepare('SELECT * FROM opportunities ORDER BY id DESC').all() as unknown as OpportunityRow[]);
  return rows;
}

export function promoteOpportunity(id: number): OpportunityRow {
  const db = getDatabase();
  db.prepare("UPDATE opportunities SET status = 'development_candidate', last_checked_at = ? WHERE id = ?").run(now(), id);
  return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as unknown as OpportunityRow;
}

export function rejectOpportunity(id: number, reason?: string): OpportunityRow {
  const db = getDatabase();
  db.prepare("UPDATE opportunities SET status = 'rejected', summary = COALESCE(?, summary), last_checked_at = ? WHERE id = ?").run(reason ?? null, now(), id);
  return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as unknown as OpportunityRow;
}
