/**
 * Adapter 注册中心 —— 数据源隔离层（V2 §9）
 * 业务层永远不直接调用第三方数据源，只通过 DataSource 名称取 Adapter
 */
import { MockAdapter } from './mock/mock-adapter.js';
import { CsvImportAdapter } from './import/csv-adapter.js';
import { ManualInputAdapter } from './manual/manual-adapter.js';
import type { MarketDataAdapter } from './types.js';
import { getDatabase } from '../db/connection.js';

const mock = new MockAdapter();
const manual = new ManualInputAdapter();

export function getAdapter(name: string, csvText?: string): MarketDataAdapter {
  switch (name) {
    case 'mock':
      return mock;
    case 'manual':
      return manual;
    case 'sellersprite-import':
      if (!csvText) throw new Error('sellersprite-import 需要提供 CSV 文本');
      return new CsvImportAdapter(csvText);
    default: {
      // 支持按 data_sources 表中注册的名称解析
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM data_sources WHERE name = ?').get(name) as
        | { type: string; config_json: string | null }
        | undefined;
      if (row?.type === 'sellersprite_mcp') return mock; // MCP 未接入时以 Mock 占位（明确标记）
      if (row?.type === 'sellersprite_import') {
        if (!csvText) throw new Error('该数据源需要上传 CSV 文件');
        return new CsvImportAdapter(csvText);
      }
      throw new Error(`未知数据源 Adapter: ${name}`);
    }
  }
}

export { MockAdapter, CsvImportAdapter, ManualInputAdapter, mock, manual };
export type { MarketDataAdapter };
