/**
 * REST API（V2 §56 清单）
 * 注意：所有响应带 X-Demo-Data 头，表明演示数据状态
 */
import { Router, type Request, type Response } from 'express';
import { getDatabase } from '../db/connection.js';
import { getMode } from '../config/mode.js';
import { createResearchJob, getResearchJob, listResearchJobs, listSteps } from '../modules/research/job.js';
import { runResearchJob, retryResearchJob } from '../workflows/orchestrator.js';
import {
  approveResearchJob,
  rejectResearchJob,
  watchResearchJob,
  listOpportunities,
  promoteOpportunity,
  rejectOpportunity,
  listDecisions,
} from '../modules/decisions/engine.js';
import { listEvidenceByJob } from '../modules/evidence/engine.js';
import { createRuleProfile, listRuleProfiles } from '../modules/rules/profile.js';
import { listMarketSnapshots, listProductSnapshots } from '../modules/snapshots/engine.js';
import { CsvImportAdapter } from '../adapters/import/csv-adapter.js';
import { normalizeProductData } from '../normalization/engine.js';
import type { ResearchJobType } from '../types/models.js';

export const api = Router();

// API 响应一律禁止浏览器缓存（运行任务后页面必须看到最新数据）
api.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const hasDemo = (db: ReturnType<typeof getDatabase>): boolean => {
  const row = db.prepare("SELECT COUNT(*) AS c FROM product_snapshots WHERE is_demo = 1").get() as { c: number };
  return row.c > 0;
};

api.use((req: Request, res: Response, next) => {
  const mode = getMode();
  res.setHeader('X-Demo-Data', mode === 'DEMO' ? 'true' : 'false');
  res.setHeader('X-System-Mode', mode);
  next();
});

// ===== 首页简报（V2 §45-46）=====
api.get('/dashboard/briefing', (_req, res) => {
  const db = getDatabase();
  const insights = db
    .prepare(
      `SELECT i.*, j.name AS job_name FROM ai_insights i
       LEFT JOIN research_jobs j ON i.research_job_id = j.id
       WHERE i.id IN (SELECT MAX(id) FROM ai_insights GROUP BY entity_type, entity_id)
       ORDER BY i.id DESC LIMIT 12`
    )
    .all() as Array<{ id: number; entity_type: string; entity_id: number; insight_type: string; summary: string; status: string; score: number | null; confidence: number; job_name: string | null; research_job_id: number | null }>;
  const risks = insights.filter((i) => i.status.includes('跑输') || i.status.includes('下滑') || i.status.includes('风险'));
  const opportunities = insights.filter((i) => i.status.includes('增长') || i.status.includes('跑赢') || i.status.includes('机会'));
  const pendingApprovals = (db.prepare("SELECT COUNT(*) AS c FROM research_jobs WHERE status = 'waiting_approval'").get() as { c: number }).c;
  const missingCount = (db.prepare("SELECT COUNT(*) AS c FROM missing_data_items WHERE status = 'open'").get() as { c: number }).c;
  const opportunitiesCount = (db.prepare("SELECT COUNT(*) AS c FROM opportunities WHERE status = 'pending_review'").get() as { c: number }).c;
  res.json({
    generated_at: new Date().toISOString(),
    items: insights.map((i) => ({
      insight_id: i.id,
      research_job_id: i.research_job_id,
      entity_type: i.entity_type,
      entity_id: i.entity_id,
      status: i.status,
      summary: i.summary,
      score: i.score,
      confidence: i.confidence,
      source_job: i.job_name,
      traceable: true,
    })),
    counts: { risks: risks.length, opportunities: opportunities.length, pending_approvals: pendingApprovals, missing_data: missingCount, pending_review_opportunities: opportunitiesCount },
    mode: getMode(),
    demo_mode: getMode() === 'DEMO',
  });
});

// ===== Research Jobs =====
api.post('/research-jobs', (req, res) => {
  const { name, job_type, marketplace, target, description, created_by } = (req.body ?? {}) as {
    name?: string; job_type?: string; marketplace?: string; target?: string; description?: string; created_by?: string;
  };
  if (!name || !job_type) {
    res.status(400).json({ error: 'name 和 job_type 必填' });
    return;
  }
  const validTypes: ResearchJobType[] = ['existing_market', 'owned_product', 'adjacent_product', 'new_opportunity'];
  if (!validTypes.includes(job_type as ResearchJobType)) {
    res.status(400).json({ error: `job_type 必须是 ${validTypes.join('/')}` });
    return;
  }
  const job = createResearchJob({ name, job_type: job_type as ResearchJobType, marketplace, target, description, created_by });
  res.status(201).json(job);
});

api.get('/research-jobs', (req, res) => {
  const jobs = listResearchJobs({ status: req.query.status as string | undefined, job_type: req.query.job_type as string | undefined });
  res.json(jobs);
});

api.get('/research-jobs/:id', (req, res) => {
  const job = getResearchJob(Number(req.params.id));
  if (!job) {
    res.status(404).json({ error: 'ResearchJob 不存在' });
    return;
  }
  const db = getDatabase();
  const steps = listSteps(job.id);
  const evidence = listEvidenceByJob(job.id);
  const insights = db.prepare('SELECT * FROM ai_insights WHERE research_job_id = ? ORDER BY id').all(job.id);
  const decisions = listDecisions(job.id);
  const missing = db.prepare('SELECT * FROM missing_data_items WHERE research_job_id = ? AND status = ? ORDER BY id').all(job.id, 'open');
  const tasks = db.prepare('SELECT * FROM data_tasks WHERE research_job_id = ? ORDER BY id').all(job.id);
  const scores = db.prepare('SELECT * FROM score_results WHERE research_job_id = ? ORDER BY id').all(job.id);
  res.json({ ...job, steps, evidence, insights, decisions, missing_data: missing, data_tasks: tasks, score_results: scores });
});

api.post('/research-jobs/:id/run', async (req, res) => {
  try {
    const result = await runResearchJob(Number(req.params.id));
    res.json(result);
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

api.post('/research-jobs/:id/retry', async (req, res) => {
  try {
    const result = await retryResearchJob(Number(req.params.id));
    res.json(result);
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

api.post('/research-jobs/:id/approve', (req, res) => {
  try {
    const d = approveResearchJob(Number(req.params.id), req.body?.decided_by ?? 'human', req.body?.reason, req.body?.role ?? 'Admin');
    res.json(d);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // V2.1 §29：审批绕过（非 waiting_approval 状态直接批准）→ 403
    if (/仅 waiting_approval|非法状态迁移/.test(msg)) {
      res.status(403).json({ error: msg, code: 'APPROVAL_BYPASS_BLOCKED' });
      return;
    }
    res.status(422).json({ error: msg });
  }
});

api.post('/research-jobs/:id/reject', (req, res) => {
  try {
    const d = rejectResearchJob(Number(req.params.id), req.body?.decided_by ?? 'human', req.body?.reason);
    res.json(d);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/不支持拒绝/.test(msg)) {
      res.status(403).json({ error: msg, code: 'REJECT_BLOCKED' });
      return;
    }
    res.status(422).json({ error: msg });
  }
});

api.post('/research-jobs/:id/watch', (req, res) => {
  try {
    const d = watchResearchJob(Number(req.params.id), req.body?.decided_by ?? 'human', req.body?.reason);
    res.json(d);
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

api.get('/research-jobs/:id/steps', (req, res) => {
  res.json(listSteps(Number(req.params.id)));
});

api.get('/research-jobs/:id/evidence', (req, res) => {
  res.json(listEvidenceByJob(Number(req.params.id)));
});

api.get('/research-jobs/:id/missing-data', (req, res) => {
  const db = getDatabase();
  res.json(db.prepare('SELECT * FROM missing_data_items WHERE research_job_id = ? AND status = ? ORDER BY id').all(Number(req.params.id), 'open'));
});

// ===== 市场 =====
api.get('/markets', (_req, res) => {
  const db = getDatabase();
  const markets = db.prepare('SELECT * FROM markets ORDER BY level, id').all();
  res.json(markets);
});

api.get('/markets/:id', (req, res) => {
  const db = getDatabase();
  const id = Number(req.params.id);
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(id);
  if (!market) {
    res.status(404).json({ error: '市场不存在' });
    return;
  }
  const snapshots = listMarketSnapshots(id);
  const children = db.prepare('SELECT * FROM markets WHERE parent_id = ?').all(id);
  const insights = db.prepare('SELECT * FROM ai_insights WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC').all('market', id);
  res.json({ ...market, snapshots, children, insights });
});

api.get('/markets/:id/snapshots', (req, res) => {
  res.json(listMarketSnapshots(Number(req.params.id)));
});

api.get('/markets/:id/insights', (req, res) => {
  const db = getDatabase();
  res.json(db.prepare('SELECT * FROM ai_insights WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC').all('market', Number(req.params.id)));
});

// ===== 自有产品 =====
api.get('/owned-products', (req, res) => {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT o.*, m.name AS market_name FROM owned_products o LEFT JOIN markets m ON o.market_id = m.id ORDER BY o.id`
    )
    .all() as Array<Record<string, unknown> & { id: number }>;
  const result = rows.map((o) => {
    const insight = db.prepare("SELECT * FROM ai_insights WHERE entity_type = 'owned_product' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(o.id) as Record<string, unknown> | undefined;
    return { ...o, latest_insight: insight ?? null };
  });
  res.json(result);
});

api.get('/owned-products/:id', (req, res) => {
  const db = getDatabase();
  const id = Number(req.params.id);
  const owned = db.prepare('SELECT * FROM owned_products WHERE id = ?').get(id);
  if (!owned) {
    res.status(404).json({ error: '自有产品不存在' });
    return;
  }
  const insights = db.prepare("SELECT * FROM ai_insights WHERE entity_type = 'owned_product' AND entity_id = ? ORDER BY id DESC").all(id);
  res.json({ ...owned, insights });
});

api.get('/owned-products/:id/competitors', (req, res) => {
  const db = getDatabase();
  const id = Number(req.params.id);
  const rels = db.prepare('SELECT * FROM competitor_relations WHERE owned_product_id = ? ORDER BY type, id').all(id) as Array<{ competitor_product_id: number; type: string; similarity_score: number | null; reason: string | null }>;
  const out = rels.map((r) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(r.competitor_product_id) as Record<string, unknown> | undefined;
    const snap = p ? listProductSnapshots(p.id as number).slice(-1)[0] : undefined;
    return { relation: r, product: p, latest_snapshot: snap ?? null };
  });
  res.json(out);
});

api.get('/owned-products/:id/snapshots', (req, res) => {
  const db = getDatabase();
  const id = Number(req.params.id);
  const owned = db.prepare('SELECT asin FROM owned_products WHERE id = ?').get(id) as { asin: string } | undefined;
  if (!owned) {
    res.status(404).json({ error: '自有产品不存在' });
    return;
  }
  const product = db.prepare('SELECT id FROM products WHERE asin = ?').get(owned.asin) as { id: number } | undefined;
  res.json(product ? listProductSnapshots(product.id) : []);
});

api.get('/owned-products/:id/insights', (req, res) => {
  const db = getDatabase();
  res.json(db.prepare("SELECT * FROM ai_insights WHERE entity_type = 'owned_product' AND entity_id = ? ORDER BY id DESC").all(Number(req.params.id)));
});

// ===== 待开发 / 新赛道 =====
api.post('/development-projects', (req, res) => {
  const { name, target, description, marketplace } = (req.body ?? {}) as { name?: string; target?: string; description?: string; marketplace?: string };
  let resolvedTarget = target ?? '';
  if (!resolvedTarget && description) {
    try {
      resolvedTarget = (JSON.parse(description) as { product_idea?: string }).product_idea ?? '';
    } catch {
      resolvedTarget = description;
    }
  }
  const job = createResearchJob({
    name: name ?? 'Development Project',
    job_type: 'adjacent_product',
    marketplace: marketplace ?? 'US',
    target: resolvedTarget,
    description: description ?? null,
    created_by: 'api',
  });
  res.status(201).json(job);
});

api.post('/opportunity-lab/research', (req, res) => {
  const { idea, marketplace } = (req.body ?? {}) as { idea?: string; marketplace?: string };
  const job = createResearchJob({
    name: `${idea ?? 'New Opportunity'} Research`,
    job_type: 'new_opportunity',
    marketplace: marketplace ?? 'US',
    target: idea ?? '',
    description: idea ?? '',
    created_by: 'api',
  });
  res.status(201).json(job);
});

// ===== 机会池 =====
api.get('/opportunities', (req, res) => {
  res.json(listOpportunities(req.query.status as string | undefined));
});

api.post('/opportunities/:id/promote', (req, res) => {
  try {
    res.json(promoteOpportunity(Number(req.params.id)));
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

api.post('/opportunities/:id/reject', (req, res) => {
  try {
    res.json(rejectOpportunity(Number(req.params.id), req.body?.reason));
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ===== 规则 =====
api.get('/rules/profiles', (_req, res) => {
  res.json(listRuleProfiles());
});

api.post('/rules/profiles', (req, res) => {
  const { name, version, hard_gates, scoring, thresholds } = (req.body ?? {}) as {
    name?: string; version?: string; hard_gates?: unknown; scoring?: unknown; thresholds?: unknown;
  };
  if (!name) {
    res.status(400).json({ error: 'name 必填' });
    return;
  }
  const profile = createRuleProfile({
    name,
    version: version ?? '1.0.0',
    hard_gates: hard_gates as never,
    scoring: scoring as never,
    thresholds: thresholds as never,
  });
  res.status(201).json(profile);
});

// ===== 数据任务 =====
api.get('/data-tasks', (_req, res) => {
  const db = getDatabase();
  res.json(db.prepare('SELECT * FROM data_tasks ORDER BY id DESC LIMIT 100').all());
});

api.post('/data-tasks/:id/retry', async (req, res) => {
  const db = getDatabase();
  const task = db.prepare('SELECT * FROM data_tasks WHERE id = ?').get(Number(req.params.id)) as { research_job_id: number | null } | undefined;
  if (!task?.research_job_id) {
    res.status(422).json({ error: '任务不存在或无法重试' });
    return;
  }
  try {
    const result = await retryResearchJob(task.research_job_id);
    res.json(result);
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ===== 导入 =====
api.post('/import/csv', (req, res) => {
  const text = req.body?.csv ?? req.body?.text;
  const sourceName = req.body?.source_name ?? 'sellersprite-import';
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: '请提供 CSV 文本（body.csv）' });
    return;
  }
  try {
    const adapter = new CsvImportAdapter(text, 'SellerSprite(Import)');
    const products = adapter.parseProducts();
    const normalized = products.map((p) => {
      const r = normalizeProductData(p, { is_demo: false, entityType: 'product' });
      return { asin: p.asin, product_id: r.productId, missing: r.missing.map((m) => m.field) };
    });
    res.json({ imported: normalized.length, failed: products.length - normalized.length, products: normalized });
  } catch (e) {
    res.status(422).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

api.post('/import/xlsx', (_req, res) => {
  res.status(501).json({ error: '旧端点已停用：请使用 POST /api/import/sellersprite/reverse-asin 上传真实 SellerSprite 文件（xlsx/csv/tsv）' });
});

// ===== 缺失数据队列 =====
api.get('/missing-data', (_req, res) => {
  const db = getDatabase();
  res.json(db.prepare("SELECT * FROM missing_data_items WHERE status = 'open' ORDER BY id DESC LIMIT 200").all());
});

// ===== 决策记录 =====
api.get('/decisions', (_req, res) => {
  res.json(listDecisions());
});

// ===== 监控列表 =====
api.get('/watchlist', (_req, res) => {
  const db = getDatabase();
  res.json(db.prepare('SELECT * FROM watchlists ORDER BY id').all());
});

// ===== 数据源 =====
api.get('/data-sources', (_req, res) => {
  const db = getDatabase();
  res.json(db.prepare('SELECT * FROM data_sources ORDER BY id').all());
});

// ===== AI 状态 =====
api.get('/ai/status', (_req, res) => {
  const aiEnabled = process.env.AI_ENABLED === 'true' && !!process.env.AI_API_KEY;
  res.json({
    mode: aiEnabled ? 'llm' : 'rule-based',
    model: aiEnabled ? (process.env.AI_MODEL ?? 'llm') : 'rule-based-v1',
    ai_enabled: aiEnabled,
    system_mode: getMode(),
    demo_mode: getMode() === 'DEMO',
    note: aiEnabled ? '使用配置的 LLM 生成 AI 结论' : '未配置 AI Key，使用确定性分析引擎（所有结论均可复现）',
  });
});
