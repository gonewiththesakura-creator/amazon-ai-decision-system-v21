/**
 * Amazon Import Provider（V2.1 §1.3 / P0-5）——真实报表文件导入边界
 * 支持 Business Reports / Advertising Reports / Inventory Reports / Search Term Report /
 * Settlement。本版实现文件解析框架 + 已导入数据的只读能力；具体报表模板映射后续按
 * Mapping Template 扩展。
 */
import { getDatabase } from '../../db/connection.js';
import { parseImportFile, cleanCell, toNumber } from './import-engine.js';
import type { ProviderBase, ProviderConnectionStatus, Capability } from './types.js';
import type { SystemMode } from '../../config/mode.js';

export type AmazonReportType = 'business' | 'advertising' | 'inventory' | 'search_term' | 'settlement';

export class AmazonImportProvider implements ProviderBase {
  readonly name = 'amazon_import';
  readonly isMock = false;
  readonly capabilities: Capability[] = ['owned_orders', 'inventory', 'ad_metrics', 'search_terms', 'product_fees'];

  getStatus(): ProviderConnectionStatus {
    try {
      const db = getDatabase();
      const n = db.prepare("SELECT COUNT(*) AS n FROM raw_ingestions WHERE source = 'amazon'").get() as { n: number };
      return n.n > 0 ? 'Connected' : 'Unauthorized';
    } catch {
      return 'Unavailable';
    }
  }

  getStatusDetail(): string {
    return this.getStatus() === 'Connected' ? '已导入 Amazon 报表' : '尚未导入 Amazon 报表文件';
  }

  healthCheck(): Capability[] {
    return this.getStatus() === 'Connected' ? this.capabilities : [];
  }

  /** 导入 Amazon 报表文件（边界实现：解析 + Raw 落库；报表模板映射按 Mapping Template） */
  async importReport(filePath: string, opts: { reportType: AmazonReportType; marketplace: string; mode: SystemMode }): Promise<{ ingestionId: number; row_count: number; headers: string[] }> {
    const sheet = await parseImportFile(filePath);
    const db = getDatabase();
    const now = new Date().toISOString();
    const batchId = `amz-${Date.now()}`;
    const ins = db
      .prepare(
        `INSERT INTO raw_ingestions (source, source_type, source_file, endpoint, fetched_at, payload_hash, import_batch_id, mode, status, row_count, created_at)
         VALUES ('amazon', ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`
      )
      .run(opts.reportType, sheet.source_file, `import:${opts.reportType}`, now, `hash-${Date.now()}`, batchId, opts.mode, sheet.rows.length, now);
    const ingestionId = Number(ins.lastInsertRowid);
    const insertRecord = db.prepare(
      `INSERT INTO raw_records (ingestion_id, row_index, source_record_id, record_type, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    sheet.rows.forEach((row, idx) => {
      const asin = cleanCell(row['asin'] ?? row['ASIN'] ?? row['商品编号'] ?? '') ?? null;
      insertRecord.run(ingestionId, idx, asin ? `${asin}:${idx}` : null, `amazon_${opts.reportType}`, JSON.stringify({ marketplace: opts.marketplace, ...row }), now);
    });
    return { ingestionId, row_count: sheet.rows.length, headers: sheet.headers };
  }

  /** 已导入 Amazon 报表中的订单/销量摘要（真实数据只读） */
  async getImportedSalesSummary(): Promise<Array<{ asin: string; units: number; revenue: number }>> {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT raw_payload FROM raw_records rr
       JOIN raw_ingestions ri ON ri.id = rr.ingestion_id
       WHERE ri.source = 'amazon' AND ri.source_type = 'business'
       ORDER BY rr.id DESC LIMIT 500`
    ).all() as Array<{ raw_payload: string }>;
    const out: Array<{ asin: string; units: number; revenue: number }> = [];
    for (const r of rows) {
      const p = JSON.parse(r.raw_payload) as Record<string, string>;
      const asin = p['asin'] ?? p['ASIN'];
      if (!asin) continue;
      const units = toNumber(cleanCell(p['unitsOrdered'] ?? p['已订购商品数量'] ?? p['units'] ?? ''));
      const rev = toNumber(cleanCell(p['orderedProductSales'] ?? p['商品销售额'] ?? p['revenue'] ?? ''));
      if (units !== null || rev !== null) out.push({ asin, units: units ?? 0, revenue: rev ?? 0 });
    }
    return out;
  }
}

export const amazonImport = new AmazonImportProvider();
