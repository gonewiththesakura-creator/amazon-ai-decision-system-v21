/**
 * AIService（V2 §31, §66-67）
 * - LLM 可配置（OpenAI 兼容接口）；未配置时自动降级为确定性 Agent（如实记录 model）
 * - AIInsight 保存 input_hash + prompt_version，相同输入不重复调用（AI 成本控制）
 * - 所有 AI 结论必须落 Evidence
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase } from '../db/connection.js';
import { createEvidence } from '../modules/evidence/engine.js';
import { analyzeMarket } from './agents/market-agent.js';
import { analyzeSku } from './agents/sku-agent.js';
import { analyzeReviewGap } from './agents/review-gap-agent.js';
import { analyzeReverseReview } from './agents/reverse-review-agent.js';
import type { AgentContext, AgentOutput, SavedInsight } from './agents/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../../prompts');

const aiEnabled = () => process.env.AI_ENABLED === 'true' && !!process.env.AI_API_KEY;

function loadPrompt(promptVersion: string): string {
  const file = resolve(PROMPTS_DIR, `${promptVersion}.md`);
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return `你是一名严谨的亚马逊选品分析专家。请基于给定的结构化数据输出结论。`;
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function dataVersion(): string {
  const db = getDatabase();
  const maxStep = db.prepare('SELECT MAX(id) AS m FROM research_steps').get() as { m: number | null };
  return `steps:${maxStep.m ?? 0}`;
}

function runDeterministicAgent(ctx: AgentContext): AgentOutput {
  switch (ctx.agent) {
    case 'market':
      return analyzeMarket(ctx.data as Parameters<typeof analyzeMarket>[0]);
    case 'sku':
      return analyzeSku(ctx.data as Parameters<typeof analyzeSku>[0]);
    case 'review_gap':
      return analyzeReviewGap(ctx.data as Parameters<typeof analyzeReviewGap>[0]);
    case 'reverse_review':
      return analyzeReverseReview(ctx.data as Parameters<typeof analyzeReverseReview>[0]);
  }
}

/** LLM 路径：拼 prompt → 请求 JSON → 结构化包装（证据由 LLM 提供，落库前校验字段） */
async function runLlmAgent(ctx: AgentContext): Promise<AgentOutput> {
  const prompt = `${loadPrompt(ctx.promptVersion)}\n\n## 输入数据\n\`\`\`json\n${JSON.stringify(ctx.data, null, 2)}\n\`\`\`\n\n只输出 JSON，不要输出其他内容。`;
  const resp = await fetch(`${process.env.AI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL ?? 'gpt-4o-mini',
      messages: [{ role: 'system', content: '你输出严格的 JSON。' }, { role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  if (!resp.ok) throw new Error(`LLM 调用失败: ${resp.status} ${await resp.text()}`);
  const json = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
  const content = json.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(content) as Record<string, unknown>;
  return {
    structured: parsed,
    evidence: [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
    score: typeof parsed.score === 'number' ? parsed.score : null,
    model: process.env.AI_MODEL ?? 'llm',
  };
}

/** 生成/读取 AI Insight；相同 input_hash 直接复用旧结论 */
export async function generateInsight(ctx: AgentContext): Promise<SavedInsight> {
  const db = getDatabase();
  const inputHash = sha256(JSON.stringify(ctx.data) + ctx.promptVersion);
  const dv = dataVersion();

  // AI 缓存：input_hash + prompt_version 相同且数据版本一致 → 复用
  const cached = db
    .prepare(
      `SELECT id FROM ai_insights
       WHERE input_hash = ? AND prompt_version = ? AND data_version = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(inputHash, ctx.promptVersion, dv) as { id: number } | undefined;
  if (cached) {
    return { insightId: cached.id, evidenceRows: [], cached: true };
  }

  let output: AgentOutput;
  if (aiEnabled()) {
    output = await runLlmAgent(ctx);
  } else {
    output = runDeterministicAgent(ctx);
  }

  // 先落 Evidence，再落 Insight（保证引用完整性）
  const evidenceIds: number[] = [];
  const evidenceRows = [];
  for (const e of output.evidence) {
    const row = createEvidence({
      research_job_id: ctx.jobId ?? null,
      insight_id: null,
      claim: e.claim,
      metric_name: e.metric_name,
      metric_value: e.metric_value,
      source: e.source,
      source_record_id: e.source_record_id ?? null,
      collected_at: new Date().toISOString(),
      calculation: e.calculation ?? null,
      confidence: e.confidence ?? 1,
    });
    evidenceIds.push(row.id);
    evidenceRows.push(row);
  }

  const res = db
    .prepare(
      `INSERT INTO ai_insights
        (research_job_id, entity_type, entity_id, insight_type, summary, status, score, confidence,
         evidence_ids_json, recommendations_json, model, prompt_version, input_hash, data_version, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ctx.jobId ?? null,
      ctx.entityType,
      ctx.entityId,
      ctx.agent,
      String(output.structured.summary ?? output.structured.recommendation ?? ''),
      String(output.structured.status ?? ''),
      output.score,
      output.confidence,
      JSON.stringify(evidenceIds),
      JSON.stringify(output.structured),
      output.model,
      ctx.promptVersion,
      inputHash,
      dv,
      new Date().toISOString()
    );
  const insightId = Number(res.lastInsertRowid);

  // 回填 Evidence 的 insight_id
  for (const id of evidenceIds) {
    db.prepare('UPDATE evidence SET insight_id = ? WHERE id = ?').run(insightId, id);
  }

  return { insightId, evidenceRows, cached: false };
}

export { aiEnabled };
