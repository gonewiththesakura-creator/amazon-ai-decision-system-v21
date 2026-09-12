/**
 * RuleProfile —— 规则版本化（V2 §26, §51）
 * 阈值与评分全部存 JSON，禁止写死在页面/代码里
 */
import { getDatabase } from '../../db/connection.js';
import type { RuleProfile } from '../../types/models.js';

export interface HardGateRule {
  required: boolean;
  description: string;
}

export interface HardGatesConfig {
  critical_ip_risk: HardGateRule;
  required_certification: HardGateRule;
  min_contribution_profit_rate: HardGateRule & { value?: number };
  max_moq_budget_ratio: HardGateRule & { value?: number };
  dimensions_within_logistics: HardGateRule;
  critical_data_missing: HardGateRule;
}

export interface ScoringConfig {
  demand_quality: { weight: number; sub: { market_size: number; trend: number; stability: number } };
  competition_entry: { weight: number; sub: { head_concentration: number; review_barrier: number; new_product_success: number; price_competition: number } };
  profit_cash_efficiency: { weight: number };
  supply_chain_fit: { weight: number };
  risk_control: { weight: number };
}

export interface ThresholdsConfig {
  relative_performance: { clear_win: number; mild_win: number; mild_loss: number; clear_loss: number };
  opportunity_score: { strong: number; research: number; watch: number };
}

export const DEFAULT_HARD_GATES: HardGatesConfig = {
  critical_ip_risk: { required: true, description: '存在致命 IP/专利风险' },
  required_certification: { required: true, description: '所需认证无法获得' },
  min_contribution_profit_rate: { required: true, description: '预估贡献利润率低于下限', value: 15 },
  max_moq_budget_ratio: { required: true, description: 'MOQ 金额超出预算可承受比例', value: 0.25 },
  dimensions_within_logistics: { required: true, description: '尺寸/重量超出物流能力' },
  critical_data_missing: { required: true, description: '决策关键数据缺失' },
};

export const DEFAULT_SCORING: ScoringConfig = {
  demand_quality: { weight: 25, sub: { market_size: 10, trend: 10, stability: 5 } },
  competition_entry: { weight: 20, sub: { head_concentration: 5, review_barrier: 5, new_product_success: 5, price_competition: 5 } },
  profit_cash_efficiency: { weight: 25 },
  supply_chain_fit: { weight: 15 },
  risk_control: { weight: 15 },
};

export const DEFAULT_THRESHOLDS: ThresholdsConfig = {
  relative_performance: { clear_win: 10, mild_win: 3, mild_loss: -3, clear_loss: -10 },
  opportunity_score: { strong: 80, research: 65, watch: 50 },
};

const now = () => new Date().toISOString();

export function createRuleProfile(params: {
  name: string;
  version: string;
  hard_gates?: HardGatesConfig;
  scoring?: ScoringConfig;
  thresholds?: ThresholdsConfig;
  active?: boolean;
}): RuleProfile {
  const db = getDatabase();
  const res = db
    .prepare(
      `INSERT INTO rule_profiles (name, version, active, hard_gates_json, scoring_json, thresholds_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.name,
      params.version,
      params.active === false ? 0 : 1,
      JSON.stringify(params.hard_gates ?? DEFAULT_HARD_GATES),
      JSON.stringify(params.scoring ?? DEFAULT_SCORING),
      JSON.stringify(params.thresholds ?? DEFAULT_THRESHOLDS),
      now()
    );
  return getRuleProfile(Number(res.lastInsertRowid))!;
}

export function getRuleProfile(id: number): RuleProfile | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM rule_profiles WHERE id = ?').get(id);
  return row ? (row as unknown as RuleProfile) : null;
}

export function getActiveRuleProfile(name?: string): RuleProfile | null {
  const db = getDatabase();
  const row = name
    ? db.prepare('SELECT * FROM rule_profiles WHERE name = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(name)
    : db.prepare('SELECT * FROM rule_profiles WHERE active = 1 ORDER BY id DESC LIMIT 1').get();
  return row ? (row as unknown as RuleProfile) : null;
}

export function listRuleProfiles(): RuleProfile[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM rule_profiles ORDER BY id DESC').all() as unknown as RuleProfile[];
}

export function parseHardGates(p: RuleProfile): HardGatesConfig {
  try {
    return { ...DEFAULT_HARD_GATES, ...(JSON.parse(p.hard_gates_json) as Partial<HardGatesConfig>) };
  } catch {
    return DEFAULT_HARD_GATES;
  }
}

export function parseScoring(p: RuleProfile): ScoringConfig {
  try {
    return JSON.parse(p.scoring_json) as ScoringConfig;
  } catch {
    return DEFAULT_SCORING;
  }
}

export function parseThresholds(p: RuleProfile): ThresholdsConfig {
  try {
    return { ...DEFAULT_THRESHOLDS, ...(JSON.parse(p.thresholds_json) as Partial<ThresholdsConfig>) };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

/** 内置默认规则档案（V2 §51 示例） */
export function ensureDefaultProfiles(): void {
  const db = getDatabase();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM rule_profiles').get() as { c: number }).c;
  if (count > 0) return;
  createRuleProfile({
    name: 'amazon_us_memory_foam_v1',
    version: '1.0.0',
    thresholds: {
      relative_performance: { clear_win: 10, mild_win: 3, mild_loss: -3, clear_loss: -10 },
      opportunity_score: { strong: 80, research: 65, watch: 50 },
    },
  });
  createRuleProfile({
    name: 'amazon_us_new_product_default_v1',
    version: '1.0.0',
    hard_gates: {
      ...DEFAULT_HARD_GATES,
      min_contribution_profit_rate: { ...DEFAULT_HARD_GATES.min_contribution_profit_rate, value: 18 },
    },
    scoring: DEFAULT_SCORING,
    thresholds: DEFAULT_THRESHOLDS,
  });
  createRuleProfile({
    name: 'cash_conservative_v1',
    version: '1.0.0',
    hard_gates: {
      ...DEFAULT_HARD_GATES,
      min_contribution_profit_rate: { ...DEFAULT_HARD_GATES.min_contribution_profit_rate, value: 25 },
      max_moq_budget_ratio: { ...DEFAULT_HARD_GATES.max_moq_budget_ratio, value: 0.15 },
    },
    scoring: DEFAULT_SCORING,
    thresholds: DEFAULT_THRESHOLDS,
  });
}
