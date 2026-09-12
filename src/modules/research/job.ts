/**
 * ResearchJob / ResearchStep —— 系统核心对象（V2 §4-7）
 * 任何一次研究都是一个正式任务，状态机统一流转，每一步落库留痕
 */
import { getDatabase } from '../../db/connection.js';
import type {
  ResearchJob,
  ResearchJobStatus,
  ResearchJobType,
  ResearchStep,
  ResearchStepType,
} from '../../types/models.js';

const now = () => new Date().toISOString();

export interface CreateResearchJobInput {
  name: string;
  job_type: ResearchJobType;
  marketplace?: string;
  target?: string;
  description?: string | null;
  rule_profile_id?: number;
  created_by?: string;
}

export function createResearchJob(input: CreateResearchJobInput): ResearchJob {
  const db = getDatabase();
  const ts = now();
  const res = db
    .prepare(
      `INSERT INTO research_jobs (name, job_type, status, marketplace, target, description, rule_profile_id, created_by, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name,
      input.job_type,
      input.marketplace ?? 'US',
      input.target ?? '',
      input.description ?? null,
      input.rule_profile_id ?? null,
      input.created_by ?? 'system',
      ts,
      ts
    );
  return getResearchJob(Number(res.lastInsertRowid))!;
}

export function getResearchJob(id: number): ResearchJob | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM research_jobs WHERE id = ?').get(id);
  return row ? (row as unknown as ResearchJob) : null;
}

export function listResearchJobs(filter?: { status?: string; job_type?: string }): ResearchJob[] {
  const db = getDatabase();
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter?.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  if (filter?.job_type) {
    clauses.push('job_type = ?');
    params.push(filter.job_type);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM research_jobs ${where} ORDER BY id DESC`)
    .all(...params) as unknown as ResearchJob[];
}

/** 合法的状态迁移表（V2 §5 状态机；V2.1 §25/§29 修正） */
const TRANSITIONS: Record<ResearchJobStatus, ResearchJobStatus[]> = {
  draft: ['planned', 'failed'],
  planned: ['collecting', 'needs_data', 'failed'],
  collecting: ['normalizing', 'needs_data', 'failed'],
  normalizing: ['validating', 'needs_data', 'failed'],
  validating: ['calculating', 'needs_data', 'rejected', 'failed'],
  calculating: ['analyzing', 'needs_data', 'failed'],
  // V2.1 §29：禁止 analyzing → approved（researching 阶段不可直接批准）
  // 必须 reverse_review → waiting_approval → approved
  analyzing: ['reverse_review', 'monitor_ready', 'needs_data', 'failed'],
  reverse_review: ['waiting_approval', 'rejected', 'watch', 'failed'],
  waiting_approval: ['approved', 'watch', 'rejected', 'needs_data', 'failed'],
  approved: ['monitor_ready', 'failed'],
  watch: ['monitor_ready', 'failed'],
  rejected: ['failed'],
  monitor_ready: ['monitoring', 'failed'],
  monitoring: ['failed'],
  failed: ['planned'],
  needs_data: ['collecting', 'planned', 'failed'],
};

export function transitionJob(id: number, next: ResearchJobStatus, error?: string | null): ResearchJob {
  const db = getDatabase();
  const job = getResearchJob(id);
  if (!job) throw new Error(`ResearchJob ${id} 不存在`);
  const allowed = TRANSITIONS[job.status] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`非法状态迁移: ${job.status} → ${next}`);
  }
  const ts = now();
  const completed = ['approved', 'watch', 'rejected', 'monitor_ready', 'monitoring', 'failed', 'needs_data'].includes(next)
    ? ts
    : null;
  db.prepare(
    `UPDATE research_jobs SET status = ?, updated_at = ?, started_at = COALESCE(started_at, ?), completed_at = COALESCE(completed_at, ?), error = ? WHERE id = ?`
  ).run(next, ts, next === 'planned' ? ts : null, completed, error ?? null, id);
  return getResearchJob(id)!;
}

/** 直接设置状态（恢复/初始化场景，绕过迁移校验） */
export function setJobStatus(id: number, status: ResearchJobStatus): ResearchJob {
  const db = getDatabase();
  db.prepare('UPDATE research_jobs SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    now(),
    id
  );
  return getResearchJob(id)!;
}

// ===== ResearchStep =====

export function startStep(jobId: number, stepType: ResearchStepType): ResearchStep {
  const db = getDatabase();
  const ts = now();
  const res = db
    .prepare(
      `INSERT INTO research_steps (research_job_id, step_type, status, started_at)
       VALUES (?, ?, 'running', ?)`
    )
    .run(jobId, stepType, ts);
  return getStep(Number(res.lastInsertRowid))!;
}

export function completeStep(stepId: number, output?: unknown): ResearchStep {
  const db = getDatabase();
  db.prepare(
    `UPDATE research_steps SET status = 'success', completed_at = ?, output_json = ? WHERE id = ?`
  ).run(now(), output === undefined ? null : JSON.stringify(output), stepId);
  return getStep(stepId)!;
}

export function failStep(stepId: number, error: string): ResearchStep {
  const db = getDatabase();
  const step = getStep(stepId);
  const retry = (step?.retry_count ?? 0) + 1;
  db.prepare(
    `UPDATE research_steps SET status = 'failed', completed_at = ?, error = ?, retry_count = ? WHERE id = ?`
  ).run(now(), error, retry, stepId);
  return getStep(stepId)!;
}

export function getStep(id: number): ResearchStep | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM research_steps WHERE id = ?').get(id);
  return row ? (row as unknown as ResearchStep) : null;
}

export function listSteps(jobId: number): ResearchStep[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM research_steps WHERE research_job_id = ? ORDER BY id')
    .all(jobId) as unknown as ResearchStep[];
}
