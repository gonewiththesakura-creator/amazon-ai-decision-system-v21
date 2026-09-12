/**
 * 确定性计算引擎（V2 §3, §17, §28）
 * 增长率 / 百分位 / 相对表现 / 硬门槛 / 评分 —— 全部代码计算，禁止交给 LLM
 */
import type { RuleProfile } from '../../types/models.js';
import { parseHardGates, parseScoring, parseThresholds } from './profile.js';

// ===== 相对市场表现 =====

export type RelativeGrade = 'clear_win' | 'mild_win' | 'sync' | 'mild_loss' | 'clear_loss';

export const GRADE_LABEL: Record<RelativeGrade, string> = {
  clear_win: '明显跑赢',
  mild_win: '轻度跑赢',
  sync: '基本同步',
  mild_loss: '轻度跑输',
  clear_loss: '明显跑输',
};

export interface RelativePerformanceResult {
  sku_growth: number | null;
  market_growth: number | null;
  relative_delta: number | null;
  grade: RelativeGrade | null;
  thresholds: { clear_win: number; mild_win: number; mild_loss: number; clear_loss: number };
}

export function computeRelativePerformance(
  skuGrowth: number | null,
  marketGrowth: number | null,
  profile: RuleProfile
): RelativePerformanceResult {
  const t = parseThresholds(profile).relative_performance;
  const relative = skuGrowth !== null && marketGrowth !== null ? Math.round((skuGrowth - marketGrowth) * 10) / 10 : null;
  let grade: RelativeGrade | null = null;
  if (relative !== null) {
    if (relative >= t.clear_win) grade = 'clear_win';
    else if (relative >= t.mild_win) grade = 'mild_win';
    else if (relative > t.mild_loss) grade = 'sync';
    else if (relative > t.clear_loss) grade = 'mild_loss';
    else grade = 'clear_loss';
  }
  return { sku_growth: skuGrowth, market_growth: marketGrowth, relative_delta: relative, grade, thresholds: t };
}

/** 销量/价格/Review 百分位（0-100） */
export function percentile(value: number | null, sortedValues: number[]): number | null {
  if (value === null || sortedValues.length === 0) return null;
  const below = sortedValues.filter((v) => v < value).length;
  return Math.round((below / sortedValues.length) * 1000) / 10;
}

// ===== 硬门槛 =====

export interface HardGateContext {
  ip_risk: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
  certification_required: boolean;
  certification_available: boolean | null;
  contribution_profit_rate: number | null; // %
  moq_cost: number | null;
  total_budget: number | null;
  within_logistics: boolean | null;
  supply_chain_validated: boolean | null;
  critical_data_missing: boolean;
}

export type HardGateResult = 'pass' | 'reject' | 'needs_data';

export interface HardGateEvaluation {
  result: HardGateResult;
  gates: Array<{ name: string; status: 'pass' | 'fail' | 'needs_data' | 'na'; reason: string }>;
}

export function evaluateHardGates(context: HardGateContext, profile: RuleProfile): HardGateEvaluation {
  const cfg = parseHardGates(profile);
  const gates: HardGateEvaluation['gates'] = [];
  let result: HardGateResult = 'pass';

  const fail = (name: string, reason: string) => {
    gates.push({ name, status: 'fail', reason });
    result = 'reject';
  };
  const need = (name: string, reason: string) => {
    gates.push({ name, status: 'needs_data', reason });
    if (result !== 'reject') result = 'needs_data';
  };
  const pass = (name: string, reason: string) => gates.push({ name, status: 'pass', reason });

  // 1. IP 风险
  if (cfg.critical_ip_risk.required) {
    if (context.ip_risk === 'critical' || context.ip_risk === 'high') fail('critical_ip_risk', `IP/专利风险为 ${context.ip_risk}，不可进入开发`);
    else if (context.ip_risk == null) need('critical_ip_risk', 'IP/专利状态未确认');
    else pass('critical_ip_risk', `IP 风险 ${context.ip_risk} 可接受`);
  }

  // 2. 认证
  if (cfg.required_certification.required) {
    if (context.certification_required) {
      if (context.certification_available === false) fail('required_certification', '所需认证无法获得');
      else if (context.certification_available == null) need('required_certification', '认证可行性未确认');
      else pass('required_certification', '认证可获得');
    } else {
      pass('required_certification', '无强制认证要求');
    }
  }

  // 3. 贡献利润
  const minProfit = cfg.min_contribution_profit_rate.value ?? 15;
  if (context.contribution_profit_rate == null) {
    need('min_contribution_profit_rate', `贡献利润率未提供（下限 ${minProfit}%）`);
  } else if (context.contribution_profit_rate < minProfit) {
    fail('min_contribution_profit_rate', `贡献利润率 ${context.contribution_profit_rate}% < 下限 ${minProfit}%`);
  } else {
    pass('min_contribution_profit_rate', `贡献利润率 ${context.contribution_profit_rate}% ≥ ${minProfit}%`);
  }

  // 4. MOQ vs 预算
  if (context.moq_cost != null && context.total_budget != null) {
    const ratio = context.moq_cost / context.total_budget;
    const maxRatio = cfg.max_moq_budget_ratio.value ?? 0.25;
    if (ratio > maxRatio) fail('max_moq_budget_ratio', `MOQ ${context.moq_cost} 占预算 ${context.total_budget} 的 ${(ratio * 100).toFixed(0)}% > ${maxRatio * 100}%`);
    else pass('max_moq_budget_ratio', `MOQ/预算 = ${(ratio * 100).toFixed(0)}% ≤ ${maxRatio * 100}%`);
  } else {
    need('max_moq_budget_ratio', 'MOQ 或预算缺失，无法判断');
  }

  // 5. 物流尺寸
  if (context.within_logistics == null) {
    need('dimensions_within_logistics', '尺寸/重量与物流能力匹配未确认');
  } else if (!context.within_logistics) {
    fail('dimensions_within_logistics', '尺寸/重量超出物流能力');
  } else {
    pass('dimensions_within_logistics', '尺寸/重量在物流能力内');
  }

  // 6. 供应链可验证
  if (context.supply_chain_validated == null) {
    need('supply_chain_validated', '供应链能否验证未确认');
  } else if (!context.supply_chain_validated) {
    fail('supply_chain_validated', '供应链无法验证');
  } else {
    pass('supply_chain_validated', '供应链已验证');
  }

  // 7. 关键数据缺失
  if (context.critical_data_missing) {
    need('critical_data_missing', '决策关键数据缺失，需补数据后再评估');
  } else {
    pass('critical_data_missing', '关键数据齐备');
  }

  return { result, gates };
}

// ===== V2 评分体系（§27-28，总分 100，必须能展开子项）=====

export interface ScoreInput {
  market: {
    monthly_revenue: number | null;
    monthly_sales: number | null;
    growth30d: number | null;
    growth90d: number | null;
    top10_sales_share: number | null;
    median_reviews: number | null;
    new_product_share: number | null;
    avg_price: number | null;
    median_price: number | null;
  };
  product: {
    contribution_profit_rate: number | null;
    moq_cost: number | null;
    total_budget: number | null;
    supply_chain_fit: number | null; // 0-1
    within_logistics: boolean | null;
    ip_risk: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
    seasonality: 'low' | 'medium' | 'high' | null;
    compliance_complexity: 'low' | 'medium' | 'high' | null;
    price_gap_to_median: number | null; // 我们拟售价与市场中位价差距（%）
  };
}

export interface ScoreBreakdown {
  demand_quality: { score: number; max: number; sub: Record<string, { score: number; max: number; note: string }> };
  competition_entry: { score: number; max: number; sub: Record<string, { score: number; max: number; note: string }> };
  profit_cash_efficiency: { score: number; max: number; note: string };
  supply_chain_fit: { score: number; max: number; note: string };
  risk_control: { score: number; max: number; note: string };
  total: number;
  max: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function computeOpportunityScore(input: ScoreInput, profile: RuleProfile): ScoreBreakdown {
  const scoring = parseScoring(profile);
  const dq = scoring.demand_quality;
  const ce = scoring.competition_entry;

  const market = input.market;

  // 需求质量：市场规模（按月销售额）、趋势（30D）、稳定性（90D 与 30D 方向一致性）
  const revenue = market.monthly_revenue ?? (market.monthly_sales ?? 0) * (market.avg_price ?? 25);
  const sizeScore = clamp((revenue / 600000) * 10, 0, 10);
  const trendScore = clamp(((market.growth30d ?? 0) / 25) * 10, 0, 10);
  const stable = market.growth30d != null && market.growth90d != null ? market.growth30d * market.growth90d >= 0 : false;
  const stabilityScore = stable ? 5 : market.growth30d != null ? 2.5 : 0;

  // 竞争可进入性
  const concentration = market.top10_sales_share ?? 0.5;
  const headScore = clamp((1 - concentration) * 10, 0, 5); // 集中度越低越高分，满分 5
  const reviewBarrier = market.median_reviews ?? 300;
  const reviewScore = clamp((1 - Math.min(reviewBarrier, 500) / 500) * 5, 0, 5);
  const newShare = market.new_product_share ?? 0.05;
  const newScore = clamp((newShare / 0.15) * 5, 0, 5);
  const priceGap = input.product.price_gap_to_median;
  const priceScore = priceGap == null ? 2.5 : clamp((1 - Math.abs(priceGap) / 50) * 5, 0, 5);

  // 利润与现金效率
  const profitRate = input.product.contribution_profit_rate;
  const profitScore = profitRate == null ? 0 : clamp((profitRate / 30) * 15, 0, 15);
  const moqRatio = input.product.moq_cost != null && input.product.total_budget != null ? input.product.moq_cost / input.product.total_budget : null;
  const cashScore = moqRatio == null ? 5 : clamp((1 - moqRatio / 0.3) * 10, 0, 10);
  const profitTotal = clamp(profitScore + cashScore, 0, 25);

  // 供应链适配度
  const fit = input.product.supply_chain_fit;
  const logistics = input.product.within_logistics == null ? 0.5 : input.product.within_logistics ? 1 : 0;
  const supplyTotal = clamp((fit ?? 0.5) * 10 + logistics * 5, 0, 15);

  // 风险可控性
  let risk = 0;
  const ipPenalty = input.product.ip_risk === 'critical' || input.product.ip_risk === 'high' ? 6 : input.product.ip_risk === 'medium' ? 3 : input.product.ip_risk === 'low' ? 1 : 0;
  const seasonPenalty = input.product.seasonality === 'high' ? 3 : input.product.seasonality === 'medium' ? 1.5 : 0;
  const compliancePenalty = input.product.compliance_complexity === 'high' ? 3 : input.product.compliance_complexity === 'medium' ? 1.5 : 0;
  risk = clamp(15 - ipPenalty - seasonPenalty - compliancePenalty, 0, 15);

  const total = clamp(
    sizeScore + trendScore + stabilityScore + headScore + reviewScore + newScore + priceScore + profitTotal + supplyTotal + risk,
    0,
    100
  );

  return {
    demand_quality: {
      score: Math.round((sizeScore + trendScore + stabilityScore) * 10) / 10,
      max: dq.weight,
      sub: {
        market_size: { score: Math.round(sizeScore * 10) / 10, max: dq.sub.market_size, note: `月销售额 $${Math.round(revenue).toLocaleString()}` },
        trend: { score: Math.round(trendScore * 10) / 10, max: dq.sub.trend, note: `30D 增速 ${market.growth30d ?? 'N/A'}%` },
        stability: { score: stabilityScore, max: dq.sub.stability, note: stable ? '30D/90D 方向一致' : '30D/90D 方向不一致或数据不足' },
      },
    },
    competition_entry: {
      score: Math.round((headScore + reviewScore + newScore + priceScore) * 10) / 10,
      max: ce.weight,
      sub: {
        head_concentration: { score: Math.round(headScore * 10) / 10, max: ce.sub.head_concentration, note: `TOP10 销量占比 ${(concentration * 100).toFixed(0)}%` },
        review_barrier: { score: Math.round(reviewScore * 10) / 10, max: ce.sub.review_barrier, note: `评论中位数 ${reviewBarrier}` },
        new_product_success: { score: Math.round(newScore * 10) / 10, max: ce.sub.new_product_success, note: `新品占比 ${(newShare * 100).toFixed(1)}%` },
        price_competition: { score: Math.round(priceScore * 10) / 10, max: ce.sub.price_competition, note: priceGap == null ? '价格差距数据缺失' : `与中位价差距 ${priceGap}%` },
      },
    },
    profit_cash_efficiency: {
      score: Math.round(profitTotal * 10) / 10,
      max: scoring.profit_cash_efficiency.weight,
      note: profitRate == null ? '贡献利润率缺失' : `贡献利润率 ${profitRate}%，MOQ/预算 ${moqRatio == null ? 'N/A' : `${(moqRatio * 100).toFixed(0)}%`}`,
    },
    supply_chain_fit: {
      score: Math.round(supplyTotal * 10) / 10,
      max: scoring.supply_chain_fit.weight,
      note: `供应链适配 ${fit ?? 'N/A'}，物流${input.product.within_logistics == null ? '未确认' : input.product.within_logistics ? '符合' : '超出'}`,
    },
    risk_control: {
      score: Math.round(risk * 10) / 10,
      max: scoring.risk_control.weight,
      note: `IP 风险 ${input.product.ip_risk ?? 'N/A'}，季节性 ${input.product.seasonality ?? 'N/A'}，合规复杂度 ${input.product.compliance_complexity ?? 'N/A'}`,
    },
    total: Math.round(total * 10) / 10,
    max: 100,
  };
}

/** 评分分级（阈值来自 RuleProfile） */
export function scoreGrade(total: number, profile: RuleProfile): 'strong' | 'research' | 'watch' | 'no' {
  const t = parseThresholds(profile).opportunity_score;
  if (total >= t.strong) return 'strong';
  if (total >= t.research) return 'research';
  if (total >= t.watch) return 'watch';
  return 'no';
}
