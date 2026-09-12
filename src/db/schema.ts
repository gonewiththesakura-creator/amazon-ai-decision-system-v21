/**
 * 数据库 Schema —— V2 §55 的 28 张表
 * 快照表只允许 INSERT（无 UPDATE 路径），保证历史不可覆盖
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS research_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('existing_market','owned_product','adjacent_product','new_opportunity')),
  status TEXT NOT NULL DEFAULT 'draft',
  marketplace TEXT NOT NULL DEFAULT 'US',
  target TEXT NOT NULL DEFAULT '',
  description TEXT,
  rule_profile_id INTEGER,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS research_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER NOT NULL REFERENCES research_jobs(id),
  step_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input_json TEXT,
  output_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_research_steps_job ON research_steps(research_job_id);

CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES markets(id),
  level INTEGER NOT NULL DEFAULT 1,
  marketplace TEXT NOT NULL DEFAULT 'US',
  category_id TEXT,
  keywords TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  snapshot_date TEXT NOT NULL,
  monthly_sales REAL,
  monthly_revenue REAL,
  product_count INTEGER,
  seller_count INTEGER,
  brand_count INTEGER,
  avg_price REAL,
  median_price REAL,
  avg_rating REAL,
  median_reviews REAL,
  new_product_count INTEGER,
  top10_sales_share REAL,
  top20_sales_share REAL,
  source_metadata TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(market_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER REFERENCES markets(id),
  keyword TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'US',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keyword_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id),
  date TEXT NOT NULL,
  search_volume REAL,
  trend REAL,
  competing_products INTEGER,
  aba_click_share REAL,
  aba_conversion_share REAL,
  bid REAL,
  source_metadata TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asin TEXT NOT NULL UNIQUE,
  brand TEXT,
  title TEXT NOT NULL,
  image_url TEXT,
  marketplace TEXT NOT NULL DEFAULT 'US',
  market_id INTEGER REFERENCES markets(id),
  is_owned INTEGER NOT NULL DEFAULT 0,
  owned_sku_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  snapshot_date TEXT NOT NULL,
  price REAL,
  rating REAL,
  review_count INTEGER,
  bsr INTEGER,
  estimated_sales INTEGER,
  estimated_revenue REAL,
  coupon REAL,
  seller_count INTEGER,
  source_metadata TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(product_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS owned_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  asin TEXT NOT NULL UNIQUE,
  internal_name TEXT NOT NULL,
  image_url TEXT,
  market_id INTEGER REFERENCES markets(id),
  keywords TEXT,
  monitor_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS competitor_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owned_product_id INTEGER NOT NULL REFERENCES owned_products(id),
  competitor_product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('direct','top100','benchmark','fast_growth','price_peer')),
  similarity_score REAL,
  reason TEXT,
  created_at TEXT NOT NULL,
  last_verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_competitor_owned ON competitor_relations(owned_product_id);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  text TEXT NOT NULL,
  rating REAL,
  review_date TEXT,
  source TEXT NOT NULL DEFAULT 'import',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER REFERENCES research_jobs(id),
  issue TEXT NOT NULL,
  frequency REAL NOT NULL,
  competitors_affected INTEGER NOT NULL DEFAULT 0,
  is_cross_market_issue INTEGER NOT NULL DEFAULT 0,
  supply_chain_solvable INTEGER NOT NULL DEFAULT 1,
  cost_impact TEXT NOT NULL DEFAULT 'medium',
  opportunity_level TEXT NOT NULL DEFAULT 'medium',
  evidence_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  hard_gates_json TEXT NOT NULL DEFAULT '{}',
  scoring_json TEXT NOT NULL DEFAULT '{}',
  thresholds_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER REFERENCES research_jobs(id),
  rule_profile_id INTEGER REFERENCES rule_profiles(id),
  rule_type TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS score_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER REFERENCES research_jobs(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  total_score REAL NOT NULL,
  breakdown_json TEXT NOT NULL DEFAULT '{}',
  data_completeness REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER REFERENCES research_jobs(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  insight_type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  score REAL,
  confidence REAL NOT NULL DEFAULT 0,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  input_hash TEXT NOT NULL DEFAULT '',
  data_version TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_insights_entity ON ai_insights(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER REFERENCES research_jobs(id),
  insight_id INTEGER REFERENCES ai_insights(id),
  claim TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  source TEXT NOT NULL,
  source_record_id TEXT,
  collected_at TEXT NOT NULL,
  calculation TEXT,
  confidence REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'ai',
  market_id INTEGER REFERENCES markets(id),
  opportunity_score REAL,
  hard_gate_status TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  summary TEXT,
  latest_insight_id INTEGER,
  latest_reverse_review_id INTEGER,
  last_checked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER REFERENCES research_jobs(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  ai_insight_id INTEGER,
  reverse_review_id INTEGER,
  data_version TEXT,
  decided_by TEXT NOT NULL DEFAULT 'human',
  decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  watch_frequency TEXT NOT NULL DEFAULT 'daily',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  config_json TEXT,
  last_sync_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER REFERENCES research_jobs(id),
  source_id INTEGER REFERENCES data_sources(id),
  task_type TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  total INTEGER,
  success INTEGER,
  failed INTEGER,
  error_log TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS missing_data_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER REFERENCES research_jobs(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  field TEXT NOT NULL,
  missing_reason TEXT NOT NULL,
  required_for_decision INTEGER NOT NULL DEFAULT 0,
  manual_validation_required INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
`;
