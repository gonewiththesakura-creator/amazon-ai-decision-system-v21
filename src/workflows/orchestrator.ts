/**
 * Workflow Orchestrator（V2 §6；V2.1 §5/§6；V2.2 §34）—— 控制 Research Job 下一步做什么
 * 统一入口：runResearchJob(jobId) 按类型分发到四条工作流
 * V2.1：collecting 前先生成 Data Plan；required capability 缺 provider → needs_data（不自动切 Mock）
 * V2.2：Orchestrator 构建 WorkflowDataContext 并传给工作流，工作流只能按能力取 Provider，禁止 Mock
 */
import { getDatabase } from '../db/connection.js';
import { getResearchJob, transitionJob } from '../modules/research/job.js';
import { buildDataPlan } from '../modules/plans/engine.js';
import { buildWorkflowContext, type WorkflowDataContext } from './context.js';
import { runExistingMarketWorkflow } from './existing-market.workflow.js';
import { runOwnedProductWorkflow } from './owned-product.workflow.js';
import { runAdjacentProductWorkflow } from './adjacent-product.workflow.js';
import { runNewOpportunityWorkflow } from './new-opportunity.workflow.js';

export async function runResearchJob(jobId: number): Promise<{ jobId: number; status: string }> {
  const job = getResearchJob(jobId);
  if (!job) throw new Error(`ResearchJob ${jobId} 不存在`);
  if (job.status === 'monitor_ready' || job.status === 'monitoring' || job.status === 'approved' || job.status === 'rejected') {
    return { jobId, status: job.status };
  }

  // V2.1 §5：Data Plan——collecting 前自动生成；REAL 模式缺 required provider → needs_data
  const plan = buildDataPlan(jobId, job.job_type);
  if (plan.missingRequired.length > 0 && plan.mode !== 'DEMO') {
    const db = getDatabase();
    const now = new Date().toISOString();
    const ins = db.prepare(
      `INSERT INTO missing_data_items (research_job_id, entity_type, entity_id, field, missing_reason, required_for_decision, manual_validation_required, status, created_at)
       VALUES (?, 'research_job', ?, ?, ?, 1, 1, 'open', ?)`
    );
    for (const cap of plan.missingRequired) {
      ins.run(jobId, jobId, `capability:${cap}`, `REAL 模式缺少数据 Provider（${cap}），未连接 SellerSprite / Amazon 真实数据`, now);
    }
    if (job.status === 'draft') transitionJob(jobId, 'planned');
    transitionJob(jobId, 'needs_data', '当前缺少 SellerSprite / Amazon 数据，无法形成真实业务结论');
    return { jobId, status: 'needs_data' };
  }

  // V2.2 §34：Orchestrator 构建并传入 Context（Workflow 内不再自选 Provider）
  const ctx = buildWorkflowContext(jobId);

  switch (job.job_type) {
    case 'existing_market':
      await runExistingMarketWorkflow(jobId, ctx);
      break;
    case 'owned_product':
      await runOwnedProductWorkflow(jobId, ctx);
      break;
    case 'adjacent_product':
      await runAdjacentProductWorkflow(jobId, ctx);
      break;
    case 'new_opportunity':
      await runNewOpportunityWorkflow(jobId, ctx);
      break;
    default:
      throw new Error(`未知任务类型: ${(job as { job_type: string }).job_type}`);
  }

  const done = getResearchJob(jobId)!;
  return { jobId, status: done.status };
}

/** 重试：失败任务从 planned 重新开始（保留 Step 历史） */
export async function retryResearchJob(jobId: number): Promise<{ jobId: number; status: string }> {
  const job = getResearchJob(jobId);
  if (!job) throw new Error(`ResearchJob ${jobId} 不存在`);
  if (job.status !== 'failed' && job.status !== 'needs_data') {
    throw new Error(`只有 failed / needs_data 状态可以重试（当前 ${job.status}）`);
  }
  transitionJob(jobId, 'planned');
  return runResearchJob(jobId);
}

export { runExistingMarketWorkflow, runOwnedProductWorkflow, runAdjacentProductWorkflow, runNewOpportunityWorkflow };

