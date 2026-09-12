import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openInMemory, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createResearchJob, getResearchJob, listSteps } from '../../src/modules/research/job.js';
import { runResearchJob } from '../../src/workflows/orchestrator.js';
import { registerAllProviders } from '../../src/adapters/providers/index.js';
import { listEvidenceByJob } from '../../src/modules/evidence/engine.js';
import { seedOwnedProducts, seedDemoJobs } from '../../src/seed/seed-demo.js';
import { approveResearchJob } from '../../src/modules/decisions/engine.js';
import { createRuleProfile } from '../../src/modules/rules/profile.js';

test('整链路（任务 B）：CreateJob → Collect → Normalize → Snapshot → Rule → AI → Evidence → 审批', async () => {
  openInMemory();
  registerAllProviders();
  try {
    // 预置规则档案（工作流需要 active profile）
    createRuleProfile({ name: 'amazon_us_memory_foam_v1', version: '1.0.0', active: true });
    const db = getDatabase();

    const job = createResearchJob({
      name: 'IT: Memory Foam U-Shaped Pillow Feasibility',
      job_type: 'adjacent_product',
      marketplace: 'US',
      target: 'Memory Foam U-Shaped Pillow',
    });

    const r = await runResearchJob(job.id);
    assert.equal(r.status, 'waiting_approval', 'U 型枕应进入待人工审批');

    // 步骤落库
    const steps = listSteps(job.id);
    const types = steps.map((s) => s.step_type);
    assert.ok(types.includes('plan') && types.includes('collect_market') && types.includes('hard_gate') && types.includes('score') && types.includes('review_gap') && types.includes('reverse_review') && types.includes('approval'));
    assert.ok(steps.every((s) => s.status === 'success'), `全部步骤应 success：${JSON.stringify(steps.map((s) => [s.step_type, s.status]))}`);

    // 评分写入
    const score = db.prepare('SELECT total_score, breakdown_json FROM score_results WHERE research_job_id = ?').get(job.id) as { total_score: number; breakdown_json: string } | undefined;
    assert.ok(score, '应有评分结果');
    assert.ok(score.total_score > 0 && score.total_score <= 100);

    // 硬门槛
    const gate = db.prepare('SELECT * FROM rule_executions WHERE research_job_id = ? AND rule_type = ?').get(job.id, 'hard_gate') as { output_json: string } | undefined;
    assert.ok(gate, '应有硬门槛执行记录');
    assert.equal(JSON.parse(gate.output_json).result, 'pass');

    // AI 洞察 + 证据
    const insights = db.prepare('SELECT * FROM ai_insights WHERE research_job_id = ?').all(job.id) as Array<{ insight_type: string; evidence_ids_json: string; confidence: number }>;
    const typesOf = insights.map((i) => i.insight_type);
    assert.ok(typesOf.includes('review_gap') && typesOf.includes('reverse_review'), `应有 review_gap + reverse_review 洞察：${JSON.stringify(typesOf)}`);
    const evs = listEvidenceByJob(job.id);
    assert.ok(evs.length > 0, '应有证据链');
    // 证据引用完整性：所有 insight 引用的证据必须存在
    for (const i of insights) {
      const ids = JSON.parse(i.evidence_ids_json) as number[];
      const existing = new Set(evs.map((e) => e.id));
      assert.ok(ids.every((x) => existing.has(x)), `insight 引用了不存在的证据：${JSON.stringify(ids)}`);
    }

    // 机会池
    const opp = db.prepare("SELECT * FROM opportunities WHERE source_type='adjacent_product' AND status='pending_review'").get() as { opportunity_score: number } | undefined;
    assert.ok(opp, '应有 pending_review 机会项');

    // 人工审批 → 决策日志
    approveResearchJob(job.id, 'it-tester', '集成测试批准');
    assert.equal(getResearchJob(job.id)!.status, 'approved');
    const dec = db.prepare('SELECT * FROM decisions WHERE research_job_id = ?').get(job.id) as { decision: string } | undefined;
    assert.equal(dec!.decision, 'approved');
  } finally {
    closeDatabase();
  }
});

test('整链路（任务 A）：owned_product 对 SKU-A 诊断出明显跑输，而非基本同步', async () => {
  openInMemory();
  registerAllProviders();
  try {
    seedOwnedProducts();
    seedDemoJobs();
    createRuleProfile({ name: 'amazon_us_memory_foam_v1', version: '1.0.0', active: true });
    const db = getDatabase();

    // 任务 2 = SKU-A 灰色枕头诊断（seedDemoJobs 生成）
    const job = getResearchJob(2)!;
    assert.equal(job.job_type, 'owned_product');
    await runResearchJob(job.id);
    assert.equal(getResearchJob(2)!.status, 'monitor_ready');

    const insight = db.prepare("SELECT * FROM ai_insights WHERE research_job_id = 2 AND insight_type='sku' ORDER BY id DESC LIMIT 1").get() as { status: string; summary: string; confidence: number; evidence_ids_json: string } | undefined;
    assert.ok(insight, '应有 SKU 诊断洞察');
    assert.ok(insight.status.includes('跑输'), `SKU-A 应判定为跑输，实际：${insight.status}`);
    assert.ok(insight.confidence > 0.3, '置信度不应被拉低到 0.37 以下水平');
    const summary = insight.summary;
    assert.ok(!summary.includes('0% vs 市场 30D 0%'), `不允许全 0 的错误诊断：${summary}`);
    assert.match(summary, /相对表现 -1[01]\.\d%/, `相对表现应约为 -11.4%：${summary}`);

    // 证据必须有真实非零值
    const evs = listEvidenceByJob(2);
    const marketEv = evs.find((e) => e.metric_name === 'market_30d_growth');
    const skuEv = evs.find((e) => e.metric_name === 'sku_30d_growth');
    const relEv = evs.find((e) => e.metric_name === 'relative_performance');
    assert.ok(marketEv && marketEv.metric_value !== 0 && marketEv.metric_value > 10, `市场 30D 增速应为 12% 上下，实际 ${marketEv?.metric_value}`);
    assert.ok(skuEv && skuEv.metric_value > 0 && skuEv.metric_value < 3, `SKU 30D 增速应为约 0.8%，实际 ${skuEv?.metric_value}`);
    assert.ok(relEv && relEv.metric_value < -10, `相对表现应为约 -11.4%，实际 ${relEv?.metric_value}`);
  } finally {
    closeDatabase();
  }
});


