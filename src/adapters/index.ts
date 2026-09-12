/**
 * Adapter 注册中心 —— 数据源隔离层（V2 §9）
 * @deprecated（V2.2 §33）：业务 Workflow 已禁用本工厂，一律经
 * WorkflowDataContext → Data Plan → Provider Registry 按能力取真实 Provider。
 * 本工厂仅保留给 DEMO legacy 测试与种子数据使用。
 */
import { MockAdapter } from './mock/mock-adapter.js';
import { CsvImportAdapter } from './import/csv-adapter.js';
import { ManualInputAdapter } from './manual/manual-adapter.js';
import type { MarketDataAdapter } from './types.js';
import { getDatabase } from '../db/connection.js';

const mock = new MockAdapter();
const manual = new ManualInputAdapter();

/** @deprecated（V2.2 §33）仅 DEMO legacy 测试可用；生产 Workflow 禁止调用 */
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
