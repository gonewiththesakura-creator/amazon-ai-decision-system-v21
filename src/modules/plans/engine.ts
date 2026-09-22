/**
 * Data Plan（V2.1 §5）—— 每个 Research Job 在 collecting 前自动生成
 * required / optional capability 清单 + 每个 capability 的 provider 解析结果。
 * 缺数据 → needs_data（不自动切 Mock）。
 */
import { getDatabase } from '../../db/connection.js';
import { JOB_TYPE_REQUIRED_CAPABILITIES } from '../../config/source-priority.js';
import { getMode, type SystemMode } from '../../config/mode.js';
import { providerRegistry } from '../../adapters/providers/registry.js';
import type { Capability } from '../../adapters/providers/types.js';

export interface DataPlan {
  id: number;
  researchJobId: number;
  required: Capability[];
  optional: Capability[];
  providers: Record<string, string>;
  missingRequired: Capability[];
  mode: SystemMode;
}

/** 为 job 生成并落库 Data Plan；返回缺失的 required capability（≠空 → needs_data） */
export function buildDataPlan(jobId: number, jobType: string): DataPlan {
  const db = getDatabase();
  const mode = getMode();
  const def = JOB_TYPE_REQUIRED_CAPABILITIES[jobType] ?? {
    required: ['market_size', 'market_growth'],
    optional: [],
  };
  const plan = providerRegistry.planCapabilities(def.required, mode);
  const providers: Record<string, string> = {};
  for (const [c, p] of plan.resolved) providers[c] = p.name;
  // V2.2：optional 能力若能解析真实 Provider，一并纳入（REAL 下不 Mock；解析失败不算 missing）
  if (def.optional.length > 0) {
    const optPlan = providerRegistry.planCapabilities(def.optional, mode);
    for (const [c, p] of optPlan.resolved) {
      if (!providers[c]) providers[c] = p.name;
    }
  }
  const now = new Date().toISOString();
  const ins = db
    .prepare(
      `INSERT INTO data_plans (research_job_id, required_json, optional_json, providers_json, status, created_at)
       VALUES (?, ?, ?, ?, 'planned', ?)`
    )
    .run(jobId, JSON.stringify(def.required), JSON.stringify(def.optional), JSON.stringify(providers), now);
  const id = Number(ins.lastInsertRowid);
  db.prepare('UPDATE research_jobs SET data_plan_id = ?, mode = ? WHERE id = ?').run(id, mode, jobId);
  return {
    id,
    researchJobId: jobId,
    required: def.required,
    optional: def.optional,
    providers,
    missingRequired: plan.missing,
    mode,
  };
}

/** 读取 job 的 Data Plan（用于展示/对账） */
export function getDataPlan(jobId: number): DataPlan | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM data_plans WHERE research_job_id = ? ORDER BY id DESC LIMIT 1').get(jobId) as
    | { id: number; research_job_id: number; required_json: string; optional_json: string; providers_json: string }
    | undefined;
  if (!row) return null;
  const required = JSON.parse(row.required_json) as Capability[];
  const providers = JSON.parse(row.providers_json) as Record<string, string>;
  const missingRequired = required.filter((c) => !providers[c]);
  return { id: row.id, researchJobId: row.research_job_id, required, optional: JSON.parse(row.optional_json), providers, missingRequired, mode: getMode() };
}
