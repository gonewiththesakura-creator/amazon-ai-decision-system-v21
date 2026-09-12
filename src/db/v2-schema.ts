/**
 * V2.1 数据层 Schema —— "真实数据优先"新增设施
 * 新增：raw_ingestions / raw_records / normalization_mappings / mapping_queue /
 *       provider_status / calibration_stats / source_conflicts / system_settings /
 *       data_plans / reconciliation_results / capability_matrix
 * 现有表补列：owned_products(title/brand/marketplace/status)、decisions(role)、
 *             reviews(asin)、products(source)、快照表(provenance)
 */
export const V2_1_SCHEMA_SQL = `
-- 1. Raw 数据保留（§9）
CREATE TABLE IF NOT EXISTS raw_ingestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_file TEXT,
  endpoint TEXT,
  fetched_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  import_batch_id TEXT,
  mode TEXT NOT NULL DEFAULT 'REAL',
  status TEXT NOT NULL DEFAULT 'received',
  row_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingestion_id INTEGER NOT NULL REFERENCES raw_ingestions(id),
  row_index INTEGER NOT NULL,
  source_record_id TEXT,
  record_type TEXT,
  raw_payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_records_ingestion ON raw_records(ingestion_id);
CREATE INDEX IF NOT EXISTS idx_raw_records_source_id ON raw_records(source_record_id);

-- 2. Normalization 映射记录（§10）
CREATE TABLE IF NOT EXISTS normalization_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_column TEXT NOT NULL,
  standard_field TEXT NOT NULL,
  transform_formula TEXT,
  unit_conversion TEXT,
  lossy INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source, source_type, source_column)
);

-- 3. Import Mapping Queue（§40）——未知列不得静默丢弃
CREATE TABLE IF NOT EXISTS mapping_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingestion_id INTEGER REFERENCES raw_ingestions(id),
  source TEXT NOT NULL,
  source_column TEXT NOT NULL,
  sample_value TEXT,
  suggested_field TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_mapping_id INTEGER REFERENCES normalization_mappings(id),
  created_at TEXT NOT NULL,
  UNIQUE(source, source_column)
);

-- 4. Provider 状态（§14）
CREATE TABLE IF NOT EXISTS provider_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Unauthorized',
  config_hint TEXT,
  last_checked_at TEXT,
  health_detail TEXT,
  created_at TEXT NOT NULL
);

-- 5. 第三方估算校准（§22）
CREATE TABLE IF NOT EXISTS calibration_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  metric TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  bias REAL,
  mape REAL,
  median_error REAL,
  window_days INTEGER NOT NULL DEFAULT 30,
  computed_at TEXT NOT NULL,
  UNIQUE(provider, metric, window_days)
);

-- 6. Conflicting Data 并存（§21）
CREATE TABLE IF NOT EXISTS source_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  metric TEXT NOT NULL,
  source_a TEXT NOT NULL,
  value_a REAL NOT NULL,
  source_b TEXT NOT NULL,
  value_b REAL NOT NULL,
  variance_pct REAL,
  resolution TEXT NOT NULL DEFAULT 'unresolved',
  created_at TEXT NOT NULL
);

-- 7. 全局系统设置（模式 DEMO/REAL/HYBRID，§7）
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 8. Data Plan（§5）——每个 Research Job 启动前自动生成
CREATE TABLE IF NOT EXISTS data_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_job_id INTEGER NOT NULL REFERENCES research_jobs(id),
  required_json TEXT NOT NULL DEFAULT '[]',
  optional_json TEXT NOT NULL DEFAULT '[]',
  providers_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL
);

-- 9. Data Reconciliation（§11）
CREATE TABLE IF NOT EXISTS reconciliation_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingestion_id INTEGER REFERENCES raw_ingestions(id),
  entity_type TEXT NOT NULL,
  source_record_id TEXT,
  field TEXT NOT NULL,
  raw_value TEXT,
  db_value TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('MATCH','DIFFERENT','MISSING','TRANSFORMED')),
  transform_note TEXT,
  created_at TEXT NOT NULL
);

-- 10. Capability Matrix（§4）
CREATE TABLE IF NOT EXISTS capability_matrix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capability TEXT NOT NULL,
  provider TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 10,
  notes TEXT,
  UNIQUE(capability, provider)
);

-- ===== 现有表补列 =====
`;

/** 幂等补列：列不存在才 ADD */
export function ensureColumn(db: import('node:sqlite').DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
