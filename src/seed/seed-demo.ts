/**
 * Demo 种子数据（V2 §64）—— 全部 is_demo=true
 * 4 个自有 SKU / 数据源 / 默认规则档案 / 三个演示 Research Job（任务 A/B/C）
 */
import { getDatabase } from '../db/connection.js';
import { ensureDefaultProfiles } from '../modules/rules/profile.js';
import { OWNED_SKU_PROFILES } from '../adapters/mock/mock-adapter.js';
import { createResearchJob } from '../modules/research/job.js';

const now = () => new Date().toISOString();

export function seedOwnedProducts(): void {
  const db = getDatabase();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM owned_products').get() as { c: number }).c;
  if (count > 0) return;
  const stmt = db.prepare(
    `INSERT INTO owned_products (sku, asin, internal_name, image_url, market_id, keywords, monitor_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?)`
  );
  for (const p of OWNED_SKU_PROFILES) {
    stmt.run(p.sku, p.asin, p.internalName, null, `memory foam ${p.marketName.toLowerCase()}`, now(), now());
  }
}

export function seedDataSources(): void {
  const db = getDatabase();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM data_sources').get() as { c: number }).c;
  if (count > 0) return;
  const stmt = db.prepare(
    `INSERT INTO data_sources (name, type, status, config_json, last_sync_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  stmt.run('mock', 'mock', 'active', JSON.stringify({ is_demo: true }), now(), now());
  stmt.run('sellersprite-mcp', 'sellersprite_mcp', 'inactive', JSON.stringify({ note: 'MCP 未接入，当前以 Mock 占位' }), null, now());
  stmt.run('sellersprite-import', 'sellersprite_import', 'active', JSON.stringify({ note: 'CSV 导入通道就绪' }), null, now());
  stmt.run('manual', 'manual', 'active', JSON.stringify({}), null, now());
}

export function seedDemoJobs(): void {
  const db = getDatabase();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM research_jobs').get() as { c: number }).c;
  if (count > 0) return;
  // 任务 A：现有市场诊断（记忆棉枕头）
  createResearchJob({
    name: 'Memory Foam Pillow Market Monitor',
    job_type: 'existing_market',
    marketplace: 'US',
    target: 'Memory Foam Pillow',
    description: '持续监控当前记忆棉枕头市场及相关细分',
    created_by: 'seed-demo',
  });
  // 任务 A2：灰色枕头（SKU-A）竞争诊断 —— V2 验收任务 A
  createResearchJob({
    name: 'SKU-A (灰色枕头) Competitive Diagnosis',
    job_type: 'owned_product',
    marketplace: 'US',
    target: 'SKU-A',
    description: '判断灰色枕头是否跑赢市场以及主要竞争变化',
    created_by: 'seed-demo',
  });
  // 任务 B：U 型枕是否值得开发 —— V2 验收任务 B
  createResearchJob({
    name: 'Memory Foam U-Shaped Pillow Feasibility',
    job_type: 'adjacent_product',
    marketplace: 'US',
    target: 'Memory Foam U-Shaped Pillow',
    description: JSON.stringify({
      product_idea: 'Memory Foam U-Shaped Pillow',
      price_range: [24, 32],
      total_budget: 50000,
      per_product_budget: 6,
      min_profit_rate: 18,
      max_weight_kg: 1.5,
      supply_chain_capability: 'memory_foam',
      ip_risk: 'medium',
      certification_required: false,
      certification_available: true,
      contribution_profit_rate: 22,
      moq_cost: 8000,
      within_logistics: true,
      supply_chain_validated: true,
      seasonality: 'low',
      compliance_complexity: 'medium',
      price_gap_to_median: -5,
    }),
    created_by: 'seed-demo',
  });
  // 任务 C：新赛道验证 —— 小学一年级开学用品组合
  createResearchJob({
    name: 'Back to School Starter Kit Research',
    job_type: 'new_opportunity',
    marketplace: 'US',
    target: '小学一年级开学用品组合套装',
    description: '从大市场下钻到具体组合 SKU',
    created_by: 'seed-demo',
  });
}

export function seedDemo(force = false): void {
  const db = getDatabase();
  if (!force) {
    const hasData = (db.prepare('SELECT COUNT(*) AS c FROM owned_products').get() as { c: number }).c > 0;
    if (hasData) return;
  }
  ensureDefaultProfiles();
  seedDataSources();
  seedOwnedProducts();
  seedDemoJobs();
}
