/**
 * AI 分析 Agent 公共类型 —— 确定性 Agent 与 LLM Agent 统一输出形态
 */
import type { Evidence } from '../../types/models.js';

export interface AgentDraftEvidence {
  claim: string;
  metric_name: string;
  metric_value: number;
  source: string;
  source_record_id?: string | null;
  collected_at?: string;
  calculation?: string | null;
  confidence?: number;
}

export interface AgentOutput {
  /** V2 §38 结构化输出（JSON 可序列化） */
  structured: Record<string, unknown>;
  evidence: AgentDraftEvidence[];
  confidence: number;
  score: number | null;
  /** 如实记录模型：rule-based-v1（确定性）或 LLM 模型名 */
  model: string;
}

export type AgentName = 'market' | 'sku' | 'review_gap' | 'reverse_review';

export interface AgentContext {
  agent: AgentName;
  entityType: string;
  entityId: number;
  jobId?: number | null;
  promptVersion: string;
  data: unknown;
}

export interface SavedInsight {
  insightId: number;
  evidenceRows: Evidence[];
  cached: boolean;
}
