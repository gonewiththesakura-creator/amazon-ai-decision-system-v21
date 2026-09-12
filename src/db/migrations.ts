/**
 * 轻量版本化迁移：schema 幂等执行 + PRAGMA user_version
 * 后续加表/加字段只需在 MIGRATIONS 数组末尾追加一个版本条目
 */
import { SCHEMA_SQL } from './schema.js';
import { V2_1_SCHEMA_SQL, ensureColumn } from './v2-schema.js';
import type { DatabaseSync } from 'node:sqlite';

interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-schema-v2',
    up: (db) => {
      db.exec(SCHEMA_SQL);
    },
  },
  {
    version: 2,
    name: 'real-data-first-v2-1',
    up: (db) => {
      db.exec(V2_1_SCHEMA_SQL);
      // 现有表补列（幂等）
      ensureColumn(db, 'owned_products', 'title', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'owned_products', 'brand', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'owned_products', 'marketplace', "TEXT NOT NULL DEFAULT 'US'");
      ensureColumn(db, 'owned_products', 'status', "TEXT NOT NULL DEFAULT 'active'");
      ensureColumn(db, 'decisions', 'role', "TEXT NOT NULL DEFAULT 'Admin'");
      ensureColumn(db, 'reviews', 'asin', 'TEXT');
      ensureColumn(db, 'products', 'source', "TEXT NOT NULL DEFAULT 'import'");
      ensureColumn(db, 'product_snapshots', 'provenance', "TEXT NOT NULL DEFAULT 'MOCK'");
      ensureColumn(db, 'market_snapshots', 'provenance', "TEXT NOT NULL DEFAULT 'MOCK'");
      ensureColumn(db, 'keyword_snapshots', 'provenance', "TEXT NOT NULL DEFAULT 'MOCK'");
      ensureColumn(db, 'keyword_snapshots', 'aba_weekly_rank', 'REAL');
      ensureColumn(db, 'keyword_snapshots', 'clicks', 'INTEGER');
      ensureColumn(db, 'keyword_snapshots', 'impressions', 'INTEGER');
      ensureColumn(db, 'keyword_snapshots', 'purchases', 'INTEGER');
      ensureColumn(db, 'keyword_snapshots', 'purchase_rate', 'REAL');
      ensureColumn(db, 'keyword_snapshots', 'traffic_share', 'REAL');
      ensureColumn(db, 'research_jobs', 'data_plan_id', 'INTEGER');
      ensureColumn(db, 'research_jobs', 'mode', "TEXT NOT NULL DEFAULT 'DEMO'");
    },
  },
  {
    version: 3,
    name: 'keyword-snapshot-real-columns',
    up: (db) => {
      // 真实 ReverseASIN 标准列（对账/校准需要；v2 已执行过的库靠 v3 补齐）
      ensureColumn(db, 'keyword_snapshots', 'aba_weekly_rank', 'REAL');
      ensureColumn(db, 'keyword_snapshots', 'clicks', 'INTEGER');
      ensureColumn(db, 'keyword_snapshots', 'impressions', 'INTEGER');
      ensureColumn(db, 'keyword_snapshots', 'purchases', 'INTEGER');
      ensureColumn(db, 'keyword_snapshots', 'purchase_rate', 'REAL');
      ensureColumn(db, 'keyword_snapshots', 'traffic_share', 'REAL');
    },
  },
];

export function runMigrations(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let current = row.user_version;
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      db.exec('BEGIN');
      try {
        m.up(db);
        db.exec(`PRAGMA user_version = ${m.version}`);
        db.exec('COMMIT');
        current = m.version;
      } catch (e) {
        db.exec('ROLLBACK');
        throw new Error(`Migration v${m.version} (${m.name}) failed: ${String(e)}`);
      }
    }
  }
  return current;
}
