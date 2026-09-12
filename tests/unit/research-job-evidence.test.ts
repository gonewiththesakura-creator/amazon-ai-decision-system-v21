import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openInMemory, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createEvidence, assertEvidenceIntegrity, listEvidenceByJob } from '../../src/modules/evidence/engine.js';
import { createResearchJob, getResearchJob, transitionJob } from '../../src/modules/research/job.js';
import { approveResearchJob, rejectResearchJob, listDecisions } from '../../src/modules/decisions/engine.js';

test('证据引用完整性：insight 引用的证据必须真实存在（V2 §47）', () => {
  openInMemory();
  try {
    const job = createResearchJob({ name: 'Ev Job', job_type: 'existing_market', marketplace: 'US', target: 'X' });
    // 先建一条 ai_insights 记录（evidence.insight_id 外键指向它）
    const db = getDatabase();
    const ins = db
      .prepare(
        `INSERT INTO ai_insights (research_job_id, entity_type, entity_id, insight_type, summary, status, score, confidence, evidence_ids_json, recommendations_json, model, prompt_version, input_hash, data_version, generated_at)
         VALUES (?, 'market', 1, 'market', '测试', '正常', NULL, 0.8, '[]', '{}', 'rule-based-v1', 'test.v1', 'h', 'v', ?)`
      )
      .run(job.id, new Date().toISOString());
    const insightId = Number(ins.lastInsertRowid);
    const e1 = createEvidence({ research_job_id: job.id, insight_id: insightId, claim: '市场 30D 增速 12.2%', metric_name: 'market_30d_growth', metric_value: 12.2, source: 'mock', calculation: 'g30', confidence: 0.9 });
    const e2 = createEvidence({ research_job_id: job.id, insight_id: insightId, claim: '参考值', metric_name: 'market_30d_growth_alt', metric_value: 3, source: 'mock', calculation: 'g30alt', confidence: 0.5 });
    const ok = assertEvidenceIntegrity(insightId, [e1.id, e2.id]);
    assert.equal(ok.ok, true);
    const bad = assertEvidenceIntegrity(insightId, [e1.id, 424242]);
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.missing, [424242]);
  } finally {
    closeDatabase();
  }
});

test('证据按 Job 可追溯：listEvidenceByJob 返回该任务全部证据', () => {
  openInMemory();
  try {
    const j7 = createResearchJob({ name: 'Ev Job 7', job_type: 'existing_market', marketplace: 'US', target: 'X' });
    const j8 = createResearchJob({ name: 'Ev Job 8', job_type: 'existing_market', marketplace: 'US', target: 'X' });
    createEvidence({ research_job_id: j7.id, claim: 'A', metric_name: 'a', metric_value: 1, source: 'mock' });
    createEvidence({ research_job_id: j7.id, claim: 'B', metric_name: 'b', metric_value: 2, source: 'mock' });
    createEvidence({ research_job_id: j8.id, claim: 'C', metric_name: 'c', metric_value: 3, source: 'mock' });
    assert.equal(listEvidenceByJob(j7.id).length, 2);
    assert.equal(listEvidenceByJob(j8.id).length, 1);
  } finally {
    closeDatabase();
  }
});

test('ResearchJob 状态机：非法迁移被拒绝', () => {
  openInMemory();
  try {
    const j = createResearchJob({ name: 'State Test', job_type: 'existing_market', marketplace: 'US', target: 'X' });
    assert.equal(j.status, 'draft');
    transitionJob(j.id, 'planned');
    transitionJob(j.id, 'collecting');
    assert.throws(() => transitionJob(j.id, 'waiting_approval'), /非法状态迁移/);
    assert.equal(getResearchJob(j.id)!.status, 'collecting');
  } finally {
    closeDatabase();
  }
});

test('决策模块：approve 落决策日志并推进状态（Approval Gate）', () => {
  openInMemory();
  try {
    const j = createResearchJob({ name: 'Approval Test', job_type: 'adjacent_product', marketplace: 'US', target: 'Memory Foam U-Shaped Pillow' });
    transitionJob(j.id, 'planned');
    transitionJob(j.id, 'collecting');
    transitionJob(j.id, 'normalizing');
    transitionJob(j.id, 'validating');
    transitionJob(j.id, 'calculating');
    transitionJob(j.id, 'analyzing');
    transitionJob(j.id, 'reverse_review');
    transitionJob(j.id, 'waiting_approval');
    approveResearchJob(j.id, 'tester', '测试批准');
    assert.equal(getResearchJob(j.id)!.status, 'approved');
    const ds = listDecisions(j.id);
    assert.equal(ds.length, 1);
    assert.equal(ds[0]!.decision, 'approved');
    assert.equal(ds[0]!.decided_by, 'tester');
  } finally {
    closeDatabase();
  }
});

test('决策模块：reject 不删除 Job，保留现场', () => {
  openInMemory();
  try {
    const j = createResearchJob({ name: 'Reject Test', job_type: 'adjacent_product', marketplace: 'US', target: 'X' });
    transitionJob(j.id, 'planned');
    transitionJob(j.id, 'collecting');
    transitionJob(j.id, 'normalizing');
    transitionJob(j.id, 'validating');
    transitionJob(j.id, 'calculating');
    transitionJob(j.id, 'analyzing');
    transitionJob(j.id, 'reverse_review');
    transitionJob(j.id, 'waiting_approval');
    rejectResearchJob(j.id, 'tester', '不合算');
    assert.equal(getResearchJob(j.id)!.status, 'rejected');
    const ds = listDecisions(j.id);
    assert.equal(ds[0]!.decision, 'rejected');
    assert.equal(ds[0]!.reason, '不合算');
  } finally {
    closeDatabase();
  }
});
