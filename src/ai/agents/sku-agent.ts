/**
 * Owned SKU Agent（确定性版）—— 4 SKU 战情诊断（V2 §38 Owned SKU Insight）
 * 相对表现由规则引擎计算，本 Agent 负责解释、竞品变化、归因假设
 */
import type { AgentOutput, AgentDraftEvidence } from './types.js';
import { GRADE_LABEL, type RelativeGrade } from '../../modules/rules/engine.js';

export interface CompetitorChange {
  asin: string;
  title: string;
  change_type: 'price_drop' | 'price_rise' | 'rank_up' | 'rank_down' | 'sales_up' | 'sales_down' | 'review_surge';
  value: number;
  detail?: string;
}

export interface SkuAgentData {
  sku_name: string;
  asin: string;
  internal_name: string;
  market_name: string;
  market_growth30d: number | null;
  sku_growth30d: number | null;
  sku_growth90d: number | null;
  relative_delta: number | null;
  relative_grade: RelativeGrade | null;
  percentile_sales: number | null;
  percentile_price: number | null;
  percentile_review: number | null;
  competitor_changes: CompetitorChange[];
  missing: string[];
}

export function analyzeSku(data: SkuAgentData): AgentOutput {
  const evidence: AgentDraftEvidence[] = [];
  const src = 'SellerSprite(Mock)';
  const collected = new Date().toISOString();

  const push = (claim: string, metric: string, value: number, calculation?: string) => {
    evidence.push({
      claim,
      metric_name: metric,
      metric_value: Math.round(value * 1000) / 1000,
      source: src,
      source_record_id: data.asin,
      collected_at: collected,
      calculation,
      confidence: 0.85,
    });
  };

  if (data.market_growth30d !== null) push(`所属市场 30D 增速 ${data.market_growth30d}%`, 'market_30d_growth', data.market_growth30d, `${data.market_growth30d}%`);
  if (data.sku_growth30d !== null) push(`SKU 30D 增速 ${data.sku_growth30d}%`, 'sku_30d_growth', data.sku_growth30d, `${data.sku_growth30d}%`);
  if (data.relative_delta !== null) push(`相对市场表现 ${data.relative_delta}%`, 'relative_performance', data.relative_delta, `${data.sku_growth30d} - ${data.market_growth30d} = ${data.relative_delta}`);

  const gradeLabel = data.relative_grade ? GRADE_LABEL[data.relative_grade] : '数据不足';
  const status = data.relative_grade
    ? { clear_win: '🟢 明显跑赢', mild_win: '🟢 轻度跑赢', sync: '🔵 基本同步', mild_loss: '🟡 轻度跑输', clear_loss: '🔴 明显跑输' }[data.relative_grade]
    : '⚪ 数据不足';

  // 竞品变化分类
  const priceDrops = data.competitor_changes.filter((c) => c.change_type === 'price_drop');
  const fastGrowers = data.competitor_changes.filter((c) => c.change_type === 'sales_up' || c.change_type === 'rank_up');

  const possible_causes: string[] = [];
  if (data.relative_grade === 'clear_loss' || data.relative_grade === 'mild_loss') {
    if (priceDrops.length) possible_causes.push(`直接竞品降价：${priceDrops.slice(0, 3).map((c) => `${c.title}(${c.value > 0 ? '-' : ''}${c.value}%)`).join('、')}，可能分流价格敏感流量`);
    if (fastGrowers.length) possible_causes.push(`竞品增长：${fastGrowers.slice(0, 3).map((c) => c.title).join('、')} 近 30D 快速增长`);
    if ((data.percentile_review ?? 100) < 40) possible_causes.push(`Review 数量百分位仅 ${data.percentile_review}%，低于多数竞品，转化劣势`);
    possible_causes.push('广告/流量/Listing 数据缺失，无法确认是否由运营因素导致');
  } else if (data.relative_grade === 'clear_win' || data.relative_grade === 'mild_win') {
    possible_causes.push('相对市场跑赢，产品自身表现优于市场均值');
  }

  const recommended_actions: string[] = [];
  if (data.relative_grade === 'clear_loss') recommended_actions.push('优先排查 Listing 转化与流量来源，对比直接竞品价格/评论差距');
  if (data.relative_grade === 'mild_loss') recommended_actions.push('持续监控竞品价格变化，评估是否需要价格/促销应对');
  if (priceDrops.length >= 2) recommended_actions.push(`追踪 ${priceDrops.length} 个竞品的降价趋势，防止价格战蔓延`);
  if (data.missing.includes('广告数据') || data.missing.includes('Sessions') || data.missing.includes('CVR')) {
    recommended_actions.push('补充广告数据 / Sessions / CVR 后转运营模块进一步诊断');
  }

  const market_context =
    data.market_growth30d === null
      ? '市场增速数据不足'
      : data.market_growth30d >= 5
        ? `市场 30D +${data.market_growth30d}%，市场在增长`
        : data.market_growth30d <= -5
          ? `市场 30D ${data.market_growth30d}%，市场在收缩`
          : `市场 30D ${data.market_growth30d}%，市场平稳`;

  const competitor_changes = data.competitor_changes.slice(0, 8).map((c) => ({
    asin: c.asin,
    title: c.title,
    change_type: c.change_type,
    value: c.value,
    detail: c.detail ?? undefined,
  }));

  const confidence = Math.max(0.35, Math.min(0.92, 0.85 - data.missing.length * 0.06 - (data.relative_delta === null ? 0.2 : 0)));

  return {
    structured: {
      status,
      relative_performance: data.relative_delta === null ? '数据不足' : `${data.relative_delta}%（${gradeLabel}）`,
      summary: `${data.internal_name}（${data.asin}）：SKU 30D ${data.sku_growth30d ?? 'N/A'}% vs 市场 30D ${data.market_growth30d ?? 'N/A'}%，相对表现 ${data.relative_delta ?? 'N/A'}%，${status}。`,
      market_context,
      competitor_changes,
      possible_causes,
      missing_data: data.missing,
      recommended_actions,
      evidence: evidence.map((e) => ({ claim: e.claim, metric: e.metric_name, value: e.metric_value, source: e.source })),
      confidence,
    },
    evidence,
    confidence,
    score: data.relative_delta,
    model: 'rule-based-v1',
  };
}
