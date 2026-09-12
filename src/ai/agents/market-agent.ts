/**
 * Market Agent（确定性版）—— 现有市场诊断（V2 §38 Market Insight）
 * 结论全部来自快照计算，AI 只负责解释与归因
 */
import type { AgentOutput, AgentDraftEvidence } from './types.js';

export interface MarketAgentData {
  market_name: string;
  monthly_sales: number | null;
  monthly_revenue: number | null;
  product_count: number | null;
  seller_count: number | null;
  brand_count: number | null;
  growth30d: number | null;
  growth90d: number | null;
  concentration_top10: number | null;
  concentration_top20: number | null;
  new_product_share: number | null;
  median_reviews: number | null;
  avg_price: number | null;
  sub_markets: Array<{ name: string; growth30d: number | null; monthly_sales: number | null; note?: string }>;
  missing: string[];
}

export function analyzeMarket(data: MarketAgentData): AgentOutput {
  const evidence: AgentDraftEvidence[] = [];
  const src = 'SellerSprite(Mock)';
  const collected = new Date().toISOString();
  const missing = data.missing;

  const push = (claim: string, metric: string, value: number, calculation?: string) => {
    evidence.push({
      claim,
      metric_name: metric,
      metric_value: Math.round(value * 1000) / 1000,
      source: src,
      source_record_id: data.market_name,
      collected_at: collected,
      calculation,
      confidence: value == null ? 0.4 : 0.85,
    });
  };

  const g30 = data.growth30d;
  const g90 = data.growth90d;
  const concentration = data.concentration_top10;
  const newShare = data.new_product_share;

  let status = '数据不足';
  if (g30 !== null && g90 !== null) {
    status = g30 >= 5 ? '增长中' : g30 <= -5 ? '下滑中' : '平稳';
    push(`市场 30D 增速 ${g30}%`, 'market_30d_growth', g30, `${g30}%`);
    push(`市场 90D 增速 ${g90}%`, 'market_90d_growth', g90, `${g90}%`);
  }
  if (concentration !== null) {
    push(`TOP10 销量占比 ${(concentration * 100).toFixed(0)}%`, 'top10_sales_share', concentration, `${(concentration * 100).toFixed(0)}%`);
  }
  if (newShare !== null) {
    push(`新品占比 ${(newShare * 100).toFixed(1)}%`, 'new_product_share', newShare, `${(newShare * 100).toFixed(1)}%`);
  }

  const opportunities: string[] = [];
  const risks: string[] = [];

  // 子市场表现
  const fastSubs = data.sub_markets.filter((s) => (s.growth30d ?? 0) >= 10);
  const decliningSubs = data.sub_markets.filter((s) => (s.growth30d ?? 0) <= -5);
  if (fastSubs.length) {
    opportunities.push(`细分市场快速增长：${fastSubs.map((s) => `${s.name}(${s.growth30d}%)`).join('、')}`);
  }
  if (decliningSubs.length) {
    risks.push(`细分市场下滑：${decliningSubs.map((s) => `${s.name}(${s.growth30d}%)`).join('、')}`);
  }

  if (g30 !== null && g30 >= 5) opportunities.push(`市场整体 30D +${g30}%，处于增长期，新品进入窗口打开`);
  if (g30 !== null && g30 <= -5) risks.push(`市场整体 30D ${g30}%，处于收缩期，需警惕存量竞争`);
  if (concentration !== null && concentration >= 0.5) risks.push(`TOP10 集中度 ${(concentration * 100).toFixed(0)}%，头部品牌主导，新品突围难度高`);
  if (concentration !== null && concentration < 0.4) opportunities.push(`TOP10 集中度 ${(concentration * 100).toFixed(0)}%，市场分散，存在长尾切入机会`);
  if (newShare !== null && newShare >= 0.08) opportunities.push(`新品占比 ${(newShare * 100).toFixed(1)}%，新进入者活跃，市场对新品友好`);
  if ((data.median_reviews ?? 0) >= 400) risks.push(`评论门槛高（中位数 ${data.median_reviews}），新品冷启动成本大`);

  const score = g30 === null ? null : Math.round(Math.max(0, Math.min(100, 50 + g30 * 2 + (concentration !== null && concentration < 0.4 ? 8 : 0) + (newShare !== null && newShare >= 0.08 ? 6 : 0))));

  const recommended_actions: string[] = [];
  if (g30 !== null && g30 >= 5) recommended_actions.push('进入快速增长细分市场做深度研究');
  if (concentration !== null && concentration >= 0.5) recommended_actions.push('避开头部垄断价格带，寻找差异化定位');
  if (missing.length) recommended_actions.push(`补充缺失数据（${missing.join('、')}）后复评`);

  const confidence = Math.max(0.3, Math.min(0.95, 0.85 - missing.length * 0.08));

  return {
    structured: {
      status,
      score,
      summary: `${data.market_name}：30D ${g30 === null ? '数据不足' : g30 + '%'}，90D ${g90 === null ? '数据不足' : g90 + '%'}，TOP10 集中度 ${concentration === null ? '数据不足' : (concentration * 100).toFixed(0) + '%'}，新品占比 ${newShare === null ? '数据不足' : (newShare * 100).toFixed(1) + '%'}。${status}。`,
      opportunities,
      risks,
      recommended_actions,
      missing_data: missing,
      evidence: evidence.map((e) => ({ claim: e.claim, metric: e.metric_name, value: e.metric_value, source: e.source })),
      confidence,
    },
    evidence,
    confidence,
    score,
    model: 'rule-based-v1',
  };
}
