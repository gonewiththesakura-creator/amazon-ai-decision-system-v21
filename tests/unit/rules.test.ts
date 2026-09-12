import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openInMemory, closeDatabase } from '../../src/db/connection.js';
import { createRuleProfile, getActiveRuleProfile, DEFAULT_HARD_GATES, DEFAULT_SCORING, DEFAULT_THRESHOLDS } from '../../src/modules/rules/profile.js';
import type { RuleProfile } from '../../src/types/models.js';
import { computeRelativePerformance, evaluateHardGates, scoreGrade, computeOpportunityScore, GRADE_LABEL } from '../../src/modules/rules/engine.js';

function makeProfile(overrides: Partial<RuleProfile> = {}): RuleProfile {
  return {
    id: 1,
    name: 'test_profile',
    version: '1.0.0',
    active: true,
    hard_gates_json: JSON.stringify(DEFAULT_HARD_GATES),
    scoring_json: JSON.stringify(DEFAULT_SCORING),
    thresholds_json: JSON.stringify(DEFAULT_THRESHOLDS),
    created_at: '',
    ...overrides,
  };
}

test('相对表现：市场 +15 / SKU -5 → 相对 -20 → 明显跑输（clear_loss）', () => {
  const profile = makeProfile();
  const r = computeRelativePerformance(-5, 15, profile);
  assert.equal(r.relative_delta, -20);
  assert.equal(r.grade, 'clear_loss');
  assert.equal(GRADE_LABEL[r.grade!], '明显跑输');
});

test('相对表现：市场 +12.2 / SKU +0.8 → 相对 -11.4 → 明显跑输（验收任务 A 场景）', () => {
  const profile = makeProfile();
  const r = computeRelativePerformance(0.8, 12.2, profile);
  assert.equal(r.relative_delta, -11.4);
  assert.equal(r.grade, 'clear_loss');
});

test('相对表现：市场 +12.2 / SKU +8.5 → 相对 -3.7 → 轻度跑输（mild_loss）', () => {
  const profile = makeProfile();
  const r = computeRelativePerformance(8.5, 12.2, profile);
  assert.equal(r.grade, 'mild_loss');
});

test('相对表现：市场 缺数据 → relative 为 null，不得编造 0', () => {
  const profile = makeProfile();
  const r = computeRelativePerformance(null, 12.2, profile);
  assert.equal(r.relative_delta, null);
  assert.equal(r.grade, null);
});

test('HardGate：ip_risk=critical → reject', () => {
  const profile = makeProfile();
  const g = evaluateHardGates(
    {
      ip_risk: 'critical',
      certification_required: false,
      certification_available: null,
      contribution_profit_rate: 22,
      moq_cost: 20000,
      total_budget: 100000,
      within_logistics: true,
      supply_chain_validated: true,
      critical_data_missing: false,
    },
    profile
  );
  assert.equal(g.result, 'reject');
  assert.ok(g.gates.some((x) => x.name === 'critical_ip_risk' && x.status === 'fail'));
});

test('HardGate：ip_risk 未确认 → needs_data（不静默放行）', () => {
  const profile = makeProfile();
  const g = evaluateHardGates(
    {
      ip_risk: null,
      certification_required: false,
      certification_available: null,
      contribution_profit_rate: 22,
      moq_cost: 20000,
      total_budget: 100000,
      within_logistics: true,
      supply_chain_validated: true,
      critical_data_missing: false,
    },
    profile
  );
  assert.equal(g.result, 'needs_data');
});

test('HardGate：全部达标 → pass', () => {
  const profile = makeProfile();
  const g = evaluateHardGates(
    {
      ip_risk: 'low',
      certification_required: false,
      certification_available: null,
      contribution_profit_rate: 22,
      moq_cost: 20000,
      total_budget: 100000,
      within_logistics: true,
      supply_chain_validated: true,
      critical_data_missing: false,
    },
    profile
  );
  assert.equal(g.result, 'pass');
});

test('评分：五维权重与分档（25/20/25/15/15）', async () => {
  openInMemory();
  try {
    createRuleProfile({ name: 'test_score_profile', version: '1.0.0' });
    const profile = getActiveRuleProfile('test_score_profile');
    assert.ok(profile, 'profile 应已创建');
    const b = computeOpportunityScore(
      {
        market: {
          monthly_revenue: 344328,
          monthly_sales: 31200,
          growth30d: 17.9,
          growth90d: 14,
          top10_sales_share: 0.31,
          median_reviews: 120,
          new_product_share: 0.13,
          avg_price: 26,
          median_price: 25,
        },
        product: {
          contribution_profit_rate: 22,
          moq_cost: null,
          total_budget: null,
          supply_chain_fit: 0.75,
          within_logistics: true,
          ip_risk: 'medium',
          seasonality: 'low',
          compliance_complexity: 'medium',
          price_gap_to_median: -5,
        },
      },
      profile
    );
    assert.equal(b.max, 100);
    assert.ok(b.total >= 0 && b.total <= 100, '总分在 0-100');
    assert.equal(b.demand_quality.max, 25);
    assert.equal(b.competition_entry.max, 20);
    assert.equal(b.profit_cash_efficiency.max, 25);
    assert.equal(b.supply_chain_fit.max, 15);
    assert.equal(b.risk_control.max, 15);
    const grade = scoreGrade(b.total, profile);
    assert.ok(['strong', 'research', 'watch', 'no'].includes(grade));
    // 数据完整场景应落在 research 及以上（≈70+）
    assert.ok(grade !== 'no', `评分 ${b.total} 不应落入 no 档`);
  } finally {
    closeDatabase();
  }
});

