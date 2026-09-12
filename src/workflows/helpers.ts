/**
 * 工作流公共助手
 */
import { startStep, completeStep, failStep } from '../modules/research/job.js';
import type { ResearchStepType } from '../types/models.js';
import { getDatabase } from '../db/connection.js';

/** 执行一个工作流步骤：记录 Step、成功/失败落库 */
export async function runStep<T>(
  jobId: number,
  stepType: ResearchStepType,
  fn: () => Promise<T> | T
): Promise<T> {
  const step = startStep(jobId, stepType);
  try {
    const result = await fn();
    completeStep(step.id, result);
    return result;
  } catch (e) {
    failStep(step.id, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export interface DataTaskResult {
  total: number;
  success: number;
  failed: number;
  error_log?: string | null;
}

export function recordDataTask(params: {
  jobId: number;
  sourceName?: string;
  taskType: string;
  target?: string | null;
  status: 'pending' | 'running' | 'success' | 'partial' | 'failed';
  result?: Partial<DataTaskResult>;
  error?: string | null;
}): number {
  const db = getDatabase();
  const source = params.sourceName
    ? (db.prepare('SELECT id FROM data_sources WHERE name = ?').get(params.sourceName) as { id: number } | undefined)
    : undefined;
  const ts = new Date().toISOString();
  const res = db
    .prepare(
      `INSERT INTO data_tasks (research_job_id, source_id, task_type, target, status, started_at, completed_at, total, success, failed, error_log, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.jobId,
      source?.id ?? null,
      params.taskType,
      params.target ?? null,
      params.status,
      ts,
      params.status === 'success' || params.status === 'partial' || params.status === 'failed' ? ts : null,
      params.result?.total ?? null,
      params.result?.success ?? null,
      params.result?.failed ?? null,
      params.error ?? params.result?.error_log ?? null,
      ts
    );
  return Number(res.lastInsertRowid);
}

export function addWatchlist(params: { item_type: string; item_id: number; watch_frequency: string; status?: string }): void {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM watchlists WHERE item_type = ? AND item_id = ?')
    .get(params.item_type, params.item_id) as { id: number } | undefined;
  if (existing) return;
  db.prepare(
    `INSERT INTO watchlists (item_type, item_id, watch_frequency, status, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(params.item_type, params.item_id, params.watch_frequency, params.status ?? 'active', new Date().toISOString());
}
