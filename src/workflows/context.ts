/**
 * WorkflowDataContext（V2.2 §4-§6）
 * Workflow 获取数据的唯一入口：Research Job → Data Plan → Provider Registry → Resolved Provider → Capability Method。
 * 业务 Workflow 禁止自行 getAdapter('mock') 或按平台名取 Provider，只能按能力取。
 */
import { getMode, type SystemMode } from '../config/mode.js';
import { providerRegistry, type RegisteredProvider } from '../adapters/providers/registry.js';
import { NeedsDataError, type Capability, type ProviderBase } from '../adapters/providers/types.js';
import { buildDataPlan, getDataPlan, type DataPlan } from '../modules/plans/engine.js';
import { getResearchJob } from '../modules/research/job.js';

export interface WorkflowDataContext {
  jobId: number;
  mode: SystemMode;
  dataPlan: DataPlan;
  /** capability → 已解析 Provider（本轮运行保持固定，§35） */
  providers: Record<Capability, RegisteredProvider>;
}

/** REAL 模式数据模式违规：Data Plan 解析结果包含 Mock */
export class DataModeViolationError extends Error {
  constructor(messages: string[]) {
    super(`DATA_MODE violation: ${messages.join('; ')}`);
    this.name = 'DataModeViolationError';
  }
}

/** REAL 模式强约束（§29）：resolved providers 不得包含 isMock=true */
export function assertNoMockProviders(ctx: Pick<WorkflowDataContext, 'mode' | 'providers'>): void {
  if (ctx.mode !== 'REAL') return;
  const violations: string[] = [];
  for (const [cap, p] of Object.entries(ctx.providers)) {
    if (p.isMock) violations.push(`capability=${cap} -> ${p.name} (isMock)`);
  }
  if (violations.length > 0) throw new DataModeViolationError(violations);
}

/** 构建 Workflow 数据上下文：Job → Data Plan（缺则生成）→ 按能力解析 Provider → REAL 禁 Mock 校验 */
export function buildWorkflowContext(jobId: number): WorkflowDataContext {
  const job = getResearchJob(jobId);
  if (!job) throw new Error(`ResearchJob ${jobId} 不存在`);
  const mode = getMode();
  const dataPlan = getDataPlan(jobId) ?? buildDataPlan(jobId, job.job_type);
  const providers = {} as Record<Capability, RegisteredProvider>;
  for (const [cap, name] of Object.entries(dataPlan.providers)) {
    const p = providerRegistry.get(name);
    providers[cap as Capability] = p;
  }
  const ctx: WorkflowDataContext = { jobId, mode, dataPlan, providers };
  assertNoMockProviders(ctx);
  return ctx;
}

/** 按能力取 Provider 实现（业务层向下转型调用能力方法，§6） */
export function getCapabilityProvider<T>(ctx: WorkflowDataContext, capability: Capability): T {
  const p = ctx.providers[capability];
  if (!p) {
    throw new NeedsDataError(
      [capability],
      Object.values(ctx.dataPlan.providers ?? {}),
      `当前任务的数据计划未解析出能力 ${capability} 的 Provider`
    );
  }
  if (ctx.mode === 'REAL' && p.isMock) {
    throw new DataModeViolationError([`capability=${capability} -> ${p.name} (isMock)`]);
  }
  return p.impl as T;
}
