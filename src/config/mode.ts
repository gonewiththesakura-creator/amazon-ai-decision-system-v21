/**
 * 全局系统模式（V2.1 §7）—— DEMO / REAL / HYBRID
 * 模式存于 system_settings 表，服务重启后保持
 * DEMO  ：全部 Mock（开发 UI/测试/首次演示）
 * REAL  ：禁止 Mock，缺数据 → needs_data
 * HYBRID：允许部分真实 + 部分假设，字段级 provenance 标注
 */
import { getDatabase } from '../db/connection.js';

export type SystemMode = 'DEMO' | 'REAL' | 'HYBRID';
export type Provenance = 'REAL' | 'ESTIMATED' | 'ASSUMPTION' | 'MOCK';

export const MODES: SystemMode[] = ['DEMO', 'REAL', 'HYBRID'];
const KEY = 'system_mode';
const DEFAULT_MODE: SystemMode = 'DEMO';

export function isMode(v: string): v is SystemMode {
  return (MODES as string[]).includes(v);
}

export function getMode(): SystemMode {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(KEY) as
      | { value: string }
      | undefined;
    if (row && isMode(row.value)) return row.value;
  } catch {
    /* 未初始化时回落默认 */
  }
  return DEFAULT_MODE;
}

export function setMode(mode: SystemMode): SystemMode {
  if (!isMode(mode)) throw new Error(`非法模式: ${mode}`);
  const db = getDatabase();
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(KEY, mode, new Date().toISOString());
  return mode;
}

export function modeLabel(mode: SystemMode): string {
  switch (mode) {
    case 'DEMO':
      return 'DEMO（全部 Mock，仅限开发/测试/演示）';
    case 'REAL':
      return 'REAL（真实数据优先，禁止 Mock 兜底）';
    case 'HYBRID':
      return 'HYBRID（部分真实 + 部分假设，逐字段标注）';
  }
}
