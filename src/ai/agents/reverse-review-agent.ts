/**
 * Reverse Review Agent（确定性版）—— 反向审查（V2 §30-32）
 * 强制假设"即将投入"，寻找最可能导致失败的 5 个原因；高风险未排除则不得建议开发
 */
import type { AgentOutput, AgentDraftEvidence } from './types.js';

export interface ReverseReviewData {
  product_name: string;
  market: {
    growth30d: number | null;
    growth90d: number | null;
    top10_sales_share: number | null;
    new_product_share: number | null;
    avg_price: number | null;
    median_reviews: number | null;
  };
  product: {
    price_gap_to_median: number | null;
    contribution_profit_rate: number | null;
    moq_cost: number | null;
    total_budget: number | null;
    ip_risk: string | null;
    seasonality: string | null;
    compliance_complexity: string | null;
    supply_chain_fit: number | null;
  };
  score_total: number | null;
  hard_gate_result: string | null;
  has_ad_data: boolean;
  missing: string[];
}

export interface FailureMode {
  risk: string;
  severity: 'high' | 'medium' | 'low';
  resolved: boolean;
  required_action: string;
}

export function analyzeReverseReview(data: ReverseReviewData): AgentOutput {
  const evidence: AgentDraftEvidence[] = [];
  const failures: FailureMode[] = [];
  const unknowns: string[] = [];
  const src = 'ReverseReview(rule-based)';

  const check = (risk: string, severity: 'high' | 'medium' | 'low', resolved: boolean, action: string, metric?: string, value?: number | null) => {
    failures.push({ risk, severity, resolved, required_action: action });
    if (metric && value !== undefined && value !== null) {
      evidence.push({
        claim: `反向审查：${risk}`,
        metric_name: metric,
        metric_value: value,
        source: src,
        source_record_id: data.product_name,
        collected_at: new Date().toISOString(),
        confidence: severity === 'high' ? 0.8 : 0.7,
      });
    }
  };

  // 12 项必查清单（V2 §31）
  if (data.market.growth30d !== null && data.market.growth30d > 25) {
    check('需求可能来自短期热点（30D 增速过高需验证持续性）', 'medium', false, '验证近 12 个月需求曲线', 'market_30d_growth', data.market.growth30d);
  }
  if ((data.market.top10_sales_share ?? 0) >= 0.55) {
    check('销量高度集中于头部，新品难以进入', 'high', false, '分析头部产品的可复制性与差异化空间', 'top10_sales_share', data.market.top10_sales_share);
  }
  if ((data.product.price_gap_to_median ?? 0) < -15) {
    check('新品增长依赖低价，价格战风险高', 'high', false, '重新测算利润模型，验证非低价卖点', 'price_gap_to_median', data.product.price_gap_to_median);
  }
  if (!data.has_ad_data) {
    check('广告假设过于乐观（无广告数据支撑流量获取成本）', 'medium', false, '补充 PPC/流量成本估算');
    unknowns.push('广告获客成本（CPC、CVR）');
    evidence.push({
      claim: '反向审查：无广告数据（has_ad_data=false），流量获取成本假设未验证',
      metric_name: 'has_ad_data',
      metric_value: 0,
      source: src,
      source_record_id: data.product_name,
      collected_at: new Date().toISOString(),
      confidence: 0.7,
    });
  }
  if ((data.market.median_reviews ?? 0) >= 400) {
    check('Review 门槛高，冷启动周期长', 'medium', false, '规划 Review 获取策略与启动预算', 'median_reviews', data.market.median_reviews);
  }
  if (data.product.compliance_complexity === 'high') {
    check('合规隐性成本（认证、测试、标签）可能侵蚀利润', 'high', false, '完成合规成本清单与认证报价');
  }
  if (data.product.ip_risk === 'high' || data.product.ip_risk === 'critical') {
    check('IP/专利风险未排除', 'high', false, '完成专利检索与法律意见');
  }
  if (data.product.moq_cost !== null && data.product.total_budget !== null && data.product.moq_cost / data.product.total_budget > 0.3) {
    check('现金占用高（MOQ 占预算比例过大），库存周转压力大', 'high', false, '与供应商谈判 MOQ 或寻找现货渠道', 'moq_budget_ratio', Math.round((data.product.moq_cost / data.product.total_budget) * 1000) / 1000);
  }
  if (data.product.seasonality === 'high') {
    check('强季节性，库存错配风险', 'medium', false, '制定季节性备货与清仓预案');
  }
  if (data.product.contribution_profit_rate !== null && data.product.contribution_profit_rate < 20) {
    check('利润空间薄，抗价格战能力弱', 'medium', false, '优化供应链成本或提高客单价', 'contribution_profit_rate', data.product.contribution_profit_rate);
  }
  if ((data.product.supply_chain_fit ?? 0.5) < 0.5) {
    check('供应链适配度不足，产品差异易被复制', 'medium', false, '确认供应链独家能力或差异化工艺');
  }
  if (data.missing.length > 0) {
    unknowns.push(...data.missing.slice(0, 5));
  }

  const highUnresolved = failures.filter((f) => f.severity === 'high' && !f.resolved).length;
  const allUnresolved = failures.filter((f) => !f.resolved).length;
  const verdict = highUnresolved >= 2 ? 'halt' : highUnresolved === 1 ? 'proceed_with_caution' : allUnresolved <= 2 ? 'proceed' : 'proceed_with_caution';

  const recommendation =
    verdict === 'halt'
      ? `存在 ${highUnresolved} 个未排除的高风险因素，不建议进入开发，先完成对应验证`
      : verdict === 'proceed_with_caution'
        ? `建议小规模验证：先完成 ${failures.filter((f) => !f.resolved).slice(0, 3).map((f) => f.required_action).join('、')}，再决定是否投入`
        : '风险整体可控，可进入下一阶段（仍需人工审批）';

  return {
    structured: {
      verdict,
      top_failure_modes: failures.slice(0, 5),
      unknowns,
      recommendation,
      high_unresolved: highUnresolved,
      score_total: data.score_total,
      hard_gate_result: data.hard_gate_result,
    },
    evidence,
    confidence: Math.max(0.5, 0.8 - data.missing.length * 0.03),
    score: null,
    model: 'rule-based-v1',
  };
}
