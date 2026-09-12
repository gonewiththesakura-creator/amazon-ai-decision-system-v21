/**
 * 数据库连接 —— 单例；测试可通过 setDatabasePath 切换到临时库
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runMigrations } from './migrations.js';

let db: DatabaseSync | null = null;
let dbPath: string | null = null;

export function setDatabasePath(path: string): void {
  dbPath = resolve(path);
  if (db) {
    db.close();
    db = null;
  }
}

export function getDatabase(): DatabaseSync {
  if (db) return db;
  const path = dbPath ?? resolve(process.env.DB_PATH ?? 'data/amazon-ai.db');
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** 测试用：打开内存库 */
export function openInMemory(): DatabaseSync {
  closeDatabase();
  const mem = new DatabaseSync(':memory:');
  mem.exec('PRAGMA foreign_keys = ON;');
  runMigrations(mem);
  db = mem;
  return mem;
}
