/**
 * 核心数据模型 —— 与数据库 28 张表一一对应
 * 命名遵循 V2 指令 §55；所有时间使用 ISO8601 字符串
 */

// ===== 研究任务 =====
export type ResearchJobType =
  | 'existing_market'
  | 'owned_product'
  | 'adjacent_product'
  | 'new_opportunity';

export type ResearchJobStatus =
  | 'draft'
  | 'planned'
  | 'collecting'
  | 'normalizing'
  | 'validating'
  | 'calculating'
  | 'analyzing'
  | 'reverse_review'
  | 'waiting_approval'
  | 'approved'
  | 'watch'
  | 'rejected'
  | 'monitor_ready'   // V2.1 §25：无 Scheduler 前表示"可监控"，不用 monitoring
  | 'monitoring'      // Scheduler 真正运行后才使用
  | 'failed'
  | 'needs_data';

export interface ResearchJob {
  id: number;
  name: string;
  job_type: ResearchJobType;
  status: ResearchJobStatus;
  marketplace: string;
  target: string;
  description: string | null;
  rule_profile_id: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export type ResearchStepType =
  | 'plan'
  | 'collect_market'
  | 'collect_products'
  | 'collect_keywords'
  | 'collect_reviews'
  | 'normalize'
  | 'validate'
  | 'calculate'
  | 'hard_gate'
  | 'score'
  | 'ai_analysis'
  | 'review_gap'
  | 'reverse_review'
  | 'approval'
  | 'snapshot'
  | 'report';

export type ResearchStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface ResearchStep {
  id: number;
  research_job_id: number;
  step_type: ResearchStepType;
  status: ResearchStepStatus;
  input_json: string | null;
  output_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  retry_count: number;
}

// ===== 市场 =====
export interface MarketNode {
  id: number;
  name: string;
  parent_id: number | null;
  level: number;
  marketplace: string;
  category_id: string | null;
  keywords: string | null;
  active: boolean;
  source: string;
  created_at: string;
}

export interface MarketSnapshot {
  id: number;
  market_id: number;
  snapshot_date: string;
  monthly_sales: number | null;
  monthly_revenue: number | null;
  product_count: number | null;
  seller_count: number | null;
  brand_count: number | null;
  avg_price: number | null;
  median_price: number | null;
  avg_rating: number | null;
  median_reviews: number | null;
  new_product_count: number | null;
  top10_sales_share: number | null;
  top20_sales_share: number | null;
  source_metadata: string | null;
  is_demo: boolean;
  created_at: string;
}

// ===== 关键词 =====
export interface Keyword {
  id: number;
  market_id: number | null;
  keyword: string;
  marketplace: string;
  created_at: string;
}

export interface KeywordSnapshot {
  id: number;
  keyword_id: number;
  date: string;
  search_volume: number | null;
  trend: number | null;
  competing_products: number | null;
  aba_click_share: number | null;
  aba_conversion_share: number | null;
  bid: number | null;
  source_metadata: string | null;
  is_demo: boolean;
  created_at: string;
}

// ===== 产品 =====
export interface Product {
  id: number;
  asin: string;
  brand: string | null;
  title: string;
  image_url: string | null;
  marketplace: string;
  market_id: number | null;
  is_owned: boolean;
  owned_sku_id: number | null;
  created_at: string;
}

export interface ProductSnapshot {
  id: number;
  product_id: number;
  snapshot_date: string;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  bsr: number | null;
  estimated_sales: number | null;
  estimated_revenue: number | null;
  coupon: number | null;
  seller_count: number | null;
  source_metadata: string | null;
  is_demo: boolean;
  created_at: string;
}

// ===== 自有产品 =====
export interface OwnedProduct {
  id: number;
  sku: string;
  asin: string;
  internal_name: string;
  image_url: string | null;
  market_id: number | null;
  keywords: string | null;
  monitor_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type CompetitorRelationType =
  | 'direct'
  | 'top100'
  | 'benchmark'
  | 'fast_growth'
  | 'price_peer';

export interface CompetitorRelation {
  id: number;
  owned_product_id: number;
  competitor_product_id: number;
  type: CompetitorRelationType;
  similarity_score: number | null;
  reason: string | null;
  created_at: string;
  last_verified_at: string | null;
}

// ===== 评论 =====
export interface Review {
  id: number;
  product_id: number;
  text: string;
  rating: number | null;
  review_date: string | null;
  source: string;
  created_at: string;
}

export interface ReviewInsight {
  id: number;
  research_job_id: number | null;
  issue: string;
  frequency: number;
  competitors_affected: number;
  is_cross_market_issue: boolean;
  supply_chain_solvable: boolean;
  cost_impact: 'low' | 'medium' | 'high';
  opportunity_level: 'high' | 'medium' | 'low';
  evidence_json: string | null;
  created_at: string;
}

// ===== 规则 =====
export interface RuleProfile {
  id: number;
  name: string;
  version: string;
  active: boolean;
  hard_gates_json: string;
  scoring_json: string;
  thresholds_json: string;
  created_at: string;
}

export interface RuleExecution {
  id: number;
  research_job_id: number;
  rule_profile_id: number | null;
  rule_type: string;
  input_json: string | null;
  output_json: string | null;
  created_at: string;
}

export interface ScoreResult {
  id: number;
  research_job_id: number;
  entity_type: string;
  entity_id: number;
  total_score: number;
  breakdown_json: string;
  data_completeness: number;
  created_at: string;
}

// ===== AI =====
export interface AIInsight {
  id: number;
  research_job_id: number | null;
  entity_type: string;
  entity_id: number;
  insight_type: string;
  summary: string;
  status: string;
  score: number | null;
  confidence: number;
  evidence_ids_json: string;
  recommendations_json: string;
  model: string;
  prompt_version: string;
  input_hash: string;
  data_version: string;
  generated_at: string;
}

export interface Evidence {
  id: number;
  research_job_id: number | null;
  insight_id: number | null;
  claim: string;
  metric_name: string;
  metric_value: number;
  source: string;
  source_record_id: string | null;
  collected_at: string;
  calculation: string | null;
  confidence: number;
  created_at: string;
}

// ===== 决策 =====
export interface Opportunity {
  id: number;
  name: string;
  source_type: string;
  market_id: number | null;
  opportunity_score: number | null;
  hard_gate_status: string | null;
  status: string;
  summary: string | null;
  latest_insight_id: number | null;
  latest_reverse_review_id: number | null;
  last_checked_at: string | null;
  created_at: string;
}

export interface Decision {
  id: number;
  research_job_id: number | null;
  entity_type: string;
  entity_id: number;
  decision: string;
  reason: string | null;
  ai_insight_id: number | null;
  reverse_review_id: number | null;
  data_version: string | null;
  decided_by: string;
  decided_at: string;
}

export interface WatchlistItem {
  id: number;
  item_type: string;
  item_id: number;
  watch_frequency: string;
  status: string;
  created_at: string;
}

// ===== 数据 =====
export interface DataSource {
  id: number;
  name: string;
  type: string;
  status: string;
  config_json: string | null;
  last_sync_at: string | null;
  created_at: string;
}

export type DataTaskStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed';

export interface DataTask {
  id: number;
  research_job_id: number | null;
  source_id: number | null;
  task_type: string;
  target: string | null;
  status: DataTaskStatus;
  started_at: string | null;
  completed_at: string | null;
  total: number | null;
  success: number | null;
  failed: number | null;
  error_log: string | null;
  created_at: string;
}

export interface MissingDataItem {
  id: number;
  research_job_id: number | null;
  entity_type: string;
  entity_id: number | null;
  field: string;
  missing_reason: string;
  required_for_decision: boolean;
  manual_validation_required: boolean;
  status: string;
  created_at: string;
}
