/**
 * Review Gap Agent（确定性版）—— 评论缺口分析（V2 §20-22）
 * 把"有人抱怨"升级为"商业机会"必须满足：多竞品共现 + 供应链可解决 + 成本可控
 */
import type { AgentOutput, AgentDraftEvidence } from './types.js';

export interface ReviewInput {
  product_asin: string;
  text: string;
  rating: number | null;
}

export interface ReviewGapData {
  reviews: ReviewInput[];
  /** 参与统计的竞品 ASIN 列表（用于计算 competitors_affected） */
  competitor_asins: string[];
  /** V2.2 §12：评论数据来源 Provider 名 */
  source?: string;
}

interface IssueDef {
  id: string;
  label: string;
  keywords: string[];
}

const ISSUE_DEFS: IssueDef[] = [
  { id: 'too_firm', label: '太硬', keywords: ['too firm', '太硬', 'hard', 'firm'] },
  { id: 'too_soft', label: '太软', keywords: ['too soft', '太软', 'soft', 'support'] },
  { id: 'smell', label: '气味', keywords: ['smell', '气味', 'odor', 'chemical'] },
  { id: 'neck_pressure', label: '颈部压力', keywords: ['neck', '颈部', 'pain', 'pressure'] },
  { id: 'center_sag', label: '中央凹陷', keywords: ['sag', '凹陷', 'flatten', 'dent'] },
  { id: 'pillowcase', label: '枕套问题', keywords: ['pillowcase', '枕套', 'zipper', '拉链', 'pilling'] },
  { id: 'size', label: '尺寸不符', keywords: ['size', '尺寸', 'small', 'smaller'] },
  { id: 'temperature', label: '闷热', keywords: ['hot', 'warm', 'heat', '热', '透气'] },
  { id: 'cleaning', label: '清洁问题', keywords: ['clean', 'wash', '清洗', '水洗'] },
  { id: 'packaging', label: '包装问题', keywords: ['packaging', '包装', 'damaged', '破损'] },
  { id: 'expectation_gap', label: '使用预期落差', keywords: ['expectation', '预期', 'thought', 'actually'] },
];

export function analyzeReviewGap(data: ReviewGapData): AgentOutput {
  const evidence: AgentDraftEvidence[] = [];
  const total = data.reviews.length;
  const competitorSet = new Set(data.competitor_asins);
  const perCompetitor = new Map<string, Set<string>>();

  const hits = new Map<string, number>();
  for (const r of data.reviews) {
    const text = r.text.toLowerCase();
    for (const def of ISSUE_DEFS) {
      if (def.keywords.some((k) => text.includes(k.toLowerCase()))) {
        hits.set(def.id, (hits.get(def.id) ?? 0) + 1);
        if (!perCompetitor.has(def.id)) perCompetitor.set(def.id, new Set());
        perCompetitor.get(def.id)!.add(r.product_asin);
      }
    }
  }

  const issues: Array<{
    issue: string;
    frequency: number;
    competitors_affected: number;
    is_cross_market_issue: boolean;
    supply_chain_solvable: boolean;
    cost_impact: 'low' | 'medium' | 'high';
    opportunity_level: 'high' | 'medium' | 'low';
  }> = [];

  for (const def of ISSUE_DEFS) {
    const count = hits.get(def.id) ?? 0;
    if (count === 0) continue;
    const frequency = Math.round((count / total) * 1000) / 1000;
    const affected = perCompetitor.get(def.id)?.size ?? 0;
    const crossMarket = affected >= 2;
    // 供应链可解决性（按品类常识：枕芯配方/工艺类问题可解决；清洁/尺寸部分可解决）
    const supplyChainSolvable = !['packaging', 'cleaning'].includes(def.id);
    const costImpact: 'low' | 'medium' | 'high' =
      def.id === 'too_firm' || def.id === 'too_soft' || def.id === 'neck_pressure' ? 'low' : 'medium';
    const opportunityLevel: 'high' | 'medium' | 'low' =
      crossMarket && supplyChainSolvable && frequency >= 0.12 ? 'high' : crossMarket && supplyChainSolvable ? 'medium' : 'low';

    issues.push({
      issue: def.label,
      frequency,
      competitors_affected: affected,
      is_cross_market_issue: crossMarket,
      supply_chain_solvable: supplyChainSolvable,
      cost_impact: costImpact,
      opportunity_level: opportunityLevel,
    });

    if (opportunityLevel === 'high') {
      evidence.push({
        claim: `评论高频痛点「${def.label}」出现频率 ${(frequency * 100).toFixed(0)}%，影响 ${affected} 个竞品，供应链可解决`,
        metric_name: `review_issue_${def.id}`,
        metric_value: Math.round(frequency * 1000) / 1000,
        source: data.source ?? 'Review(Mock)',
        source_record_id: `${def.id}:${affected}`,
        collected_at: new Date().toISOString(),
        calculation: `${count}/${total} = ${frequency}`,
        confidence: 0.8,
      });
    }
  }

  const high = issues.filter((i) => i.opportunity_level === 'high');
  const medium = issues.filter((i) => i.opportunity_level === 'medium');

  if (issues.length === 0) {
    // 未发现显著痛点也要留证据（如实记录 0 命中），保证证据链可追溯
    evidence.push({
      claim: `评论缺口分析：采样 ${total} 条评论，未发现跨竞品高频痛点`,
      metric_name: 'review_gap_issues_found',
      metric_value: 0,
      source: data.source ?? 'Review(Mock)',
      source_record_id: `review-gap:${total}`,
      collected_at: new Date().toISOString(),
      calculation: `${total} 条评论`,
      confidence: 0.7,
    });
  }

  return {
    structured: {
      issues,
      summary:
        high.length > 0
          ? `发现 ${high.length} 个高价值缺口：${high.map((i) => i.issue).join('、')}（多竞品共现且供应链可解决）`
          : medium.length > 0
            ? `发现 ${medium.length} 个中等价值缺口，需结合供应链成本进一步验证`
            : '未发现跨竞品的高价值痛点，需扩大评论样本',
      opportunities: high.map((i) => i.issue),
      risks: issues.filter((i) => i.opportunity_level === 'low').map((i) => `${i.issue}（偶发或不可靠产品解决）`),
      evidence: evidence.map((e) => ({ claim: e.claim, metric: e.metric_name, value: e.metric_value, source: e.source })),
      confidence: Math.min(0.9, 0.6 + total / 200),
    },
    evidence,
    confidence: Math.min(0.9, 0.6 + total / 200),
    score: high.length > 0 ? 78 : medium.length > 0 ? 60 : 40,
    model: 'rule-based-v1',
  };
}

