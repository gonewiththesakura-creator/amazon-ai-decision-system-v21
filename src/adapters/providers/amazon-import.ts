/**
 * Amazon Import Provider（V2.1 §1.3 / P0-5；V2.2 §25-§28）
 * 真实报表文件导入边界：Business / Advertising / Inventory / Search Term / Settlement。
 * V2.2 修复：
 *  - P0-7：导入摘要缺失字段保留 null（不再 ?? 0），缺失进 missing_data_items
 *  - P0-8：payload_hash 由假 hash 改为真实 SHA256（文件内容哈希）
 *  - §26：五类报表 Mapping Template；未知列 → mapping_queue（不静默丢弃）
 *  - §28：healthCheckRemote = 存在真实导入记录才算 CONNECTED（不再是"env 齐即 Connected"）
 *  - 实现 OwnedBusinessProvider（getOwnedProducts/getOrders/getInventory/getListingStatus）从真实报表只读
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getDatabase } from '../../db/connection.js';
import { parseImportFile, cleanCell, toNumber } from './import-engine.js';
import type {
  Capability,
  OwnedBusinessProvider,
  ProviderBase,
  ProviderConnectionStatus,
  ProviderHealthResult,
} from './types.js';
import type { SystemMode } from '../../config/mode.js';

export type AmazonReportType = 'business' | 'advertising' | 'inventory' | 'search_term' | 'settlement';

/** 五类报表 Mapping Template（V2.2 §26）：源列 → 标准字段 */
const REPORT_MAPPING_TEMPLATES: Record<AmazonReportType, Record<string, string>> = {
  business: {
    asin: 'asin',
    ASIN: 'asin',
    商品编号: 'asin',
    date: 'date',
    日期: 'date',
    unitsOrdered: 'units',
    已订购商品数量: 'units',
    orderedProductSales: 'revenue',
    商品销售额: 'revenue',
    sessions: 'sessions',
    sessionPercentage: 'session_percentage',
    buyBoxPercentage: 'buy_box_percentage',
    unitSessionPercentage: 'unit_session_percentage',
    averageSellingPrice: 'avg_price',
    平均售价: 'avg_price',
  },
  advertising: {
    'Campaign Name': 'campaign_name',
    广告活动名称: 'campaign_name',
    'Ad Group Name': 'ad_group_name',
    广告组名称: 'ad_group_name',
    Targeting: 'targeting',
    Impressions: 'impressions',
    展示量: 'impressions',
    Clicks: 'clicks',
    点击量: 'clicks',
    'Cost Per Click': 'cpc',
    Spend: 'spend',
    花费: 'spend',
    'Total Sales': 'sales',
    总销售额: 'sales',
    'Total Orders': 'orders',
    总订单数: 'orders',
    SKU: 'sku',
    ASIN: 'asin',
  },
  inventory: {
    sku: 'sku',
    SKU: 'sku',
    asin: 'asin',
    ASIN: 'asin',
    fnsku: 'fnsku',
    'product-name': 'product_name',
    商品名称: 'product_name',
    'quantity-available': 'quantity_available',
    可售数量: 'quantity_available',
    price: 'price',
    价格: 'price',
  },
  search_term: {
    'searchTerm': 'search_term',
    搜索词: 'search_term',
    'searchQueryVolume': 'query_volume',
    搜索量: 'query_volume',
    'searchQueryImpressionShare': 'impression_share',
    展示占比: 'impression_share',
    clicks: 'clicks',
    点击量: 'clicks',
    spend: 'spend',
    花费: 'spend',
    sales: 'sales',
    销售额: 'sales',
  },
  settlement: {
    'settlement-id': 'settlement_id',
    'settlement-start-date': 'settlement_start_date',
    'settlement-end-date': 'settlement_end_date',
    'transaction-type': 'transaction_type',
    交易类型: 'transaction_type',
    'amount-description': 'amount_description',
    金额说明: 'amount_description',
    'amount-type': 'amount_type',
    金额类型: 'amount_type',
    amount: 'amount',
    金额: 'amount',
    quantity: 'quantity',
    数量: 'quantity',
    'order-id': 'order_id',
    订单编号: 'order_id',
    sku: 'sku',
    SKU: 'sku',
    asin: 'asin',
    ASIN: 'asin',
  },
};

export class AmazonImportProvider implements ProviderBase, OwnedBusinessProvider {
  readonly name = 'amazon_import';
  readonly isMock = false;
  readonly capabilities: Capability[] = ['owned_orders', 'inventory', 'ad_metrics', 'search_terms', 'product_fees'];

  private lastHealth: ProviderHealthResult | null = null;

  getLastHealth(): ProviderHealthResult | null {
    return this.lastHealth;
  }

  getStatus(): ProviderConnectionStatus {
    try {
      const db = getDatabase();
      const n = db.prepare("SELECT COUNT(*) AS n FROM raw_ingestions WHERE source = 'amazon'").get() as { n: number };
      return n.n > 0 ? 'CONNECTED' : 'UNCONFIGURED';
    } catch {
      return 'ERROR';
    }
  }

  getStatusDetail(): string {
    return this.getStatus() === 'CONNECTED' ? '已导入 Amazon 真实报表' : '尚未导入 Amazon 报表文件';
  }

  healthCheck(): Capability[] {
    return this.getStatus() === 'CONNECTED' ? this.capabilities : [];
  }

  /** §28：真实远程检查 = 数据库中存在 Amazon 真实导入记录 */
  async healthCheckRemote(): Promise<ProviderHealthResult> {
    try {
      const db = getDatabase();
      const n = db.prepare("SELECT COUNT(*) AS n FROM raw_ingestions WHERE source = 'amazon' AND status = 'received'").get() as { n: number };
      const h: ProviderHealthResult =
        n.n > 0
          ? { status: 'CONNECTED', checkedAt: new Date().toISOString(), latencyMs: 0, capabilities: this.capabilities }
          : { status: 'UNCONFIGURED', checkedAt: new Date().toISOString(), latencyMs: 0, capabilities: [], errorCode: 'UNCONFIGURED', errorMessage: '尚未导入 Amazon 报表文件' };
      this.lastHealth = h;
      return h;
    } catch (e) {
      const h: ProviderHealthResult = {
        status: 'ERROR',
        checkedAt: new Date().toISOString(),
        capabilities: [],
        errorCode: 'UNKNOWN',
        errorMessage: e instanceof Error ? e.message : String(e),
      };
      this.lastHealth = h;
      return h;
    }
  }

  /** 导入 Amazon 报表文件：SHA256 内容哈希 + Mapping Template + 未知列入 mapping_queue */
  async importReport(
    filePath: string,
    opts: { reportType: AmazonReportType; marketplace: string; mode: SystemMode }
  ): Promise<{ ingestionId: number; row_count: number; headers: string[]; mapped: string[]; unmapped: string[]; payloadHash: string }> {
    const sheet = await parseImportFile(filePath);
    const db = getDatabase();
    const now = new Date().toISOString();
    const batchId = `amz-${Date.now()}`;
    // P0-8：真实 SHA256 内容哈希（不再是 hash-${Date.now()}）
    const buffer = readFileSync(filePath);
    const payloadHash = createHash('sha256').update(buffer).digest('hex');
    const ins = db
      .prepare(
        `INSERT INTO raw_ingestions (source, source_type, source_file, endpoint, fetched_at, payload_hash, import_batch_id, mode, status, row_count, created_at)
         VALUES ('amazon', ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`
      )
      .run(opts.reportType, sheet.source_file, `import:${opts.reportType}`, now, payloadHash, batchId, opts.mode, sheet.rows.length, now);
    const ingestionId = Number(ins.lastInsertRowid);
    const insertRecord = db.prepare(
      `INSERT INTO raw_records (ingestion_id, row_index, source_record_id, record_type, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    sheet.rows.forEach((row, idx) => {
      const asin = cleanCell(row['asin'] ?? row['ASIN'] ?? row['商品编号'] ?? '') ?? null;
      insertRecord.run(ingestionId, idx, asin ? `${asin}:${idx}` : null, `amazon_${opts.reportType}`, JSON.stringify({ marketplace: opts.marketplace, ...row }), now);
    });

    // Mapping Template 校验：未知列 → mapping_queue（§26）
    const template = REPORT_MAPPING_TEMPLATES[opts.reportType] ?? {};
    const mapped: string[] = [];
    const unmapped: string[] = [];
    const upsertQueue = db.prepare(
      `INSERT INTO mapping_queue (ingestion_id, source, source_column, sample_value, suggested_field, status, created_at)
       VALUES (?, 'amazon', ?, ?, NULL, 'pending', ?)
       ON CONFLICT(source, source_column) DO UPDATE SET ingestion_id = excluded.ingestion_id, sample_value = excluded.sample_value`
    );
    for (const header of sheet.headers) {
      const std = template[header] ?? template[header.trim()];
      if (std) {
        mapped.push(header);
        db.prepare(
          `INSERT OR IGNORE INTO normalization_mappings (source, source_type, source_column, standard_field, lossy, notes, created_at)
           VALUES ('amazon', ?, ?, ?, 0, 'mapping template', ?)`
        ).run(opts.reportType, header, std, now);
      } else {
        unmapped.push(header);
        const firstRow = sheet.rows[0];
        const sample = firstRow ? String(cleanCell(firstRow[header] ?? '') ?? '') : '';
        upsertQueue.run(ingestionId, header, sample.slice(0, 200), now);
      }
    }

    // V2.2 §25/§54：business 报表导入即检测缺失字段（null 保留 + missing_data_items 落库，禁止补 0）
    if (opts.reportType === 'business') {
      await this.getImportedSalesSummary();
    }

    return { ingestionId, row_count: sheet.rows.length, headers: sheet.headers, mapped, unmapped, payloadHash };
  }

  /** 已导入 business 报表中的订单/销量摘要（P0-7：缺失字段保留 null 而非补 0） */
  async getImportedSalesSummary(): Promise<Array<{ asin: string; units: number | null; revenue: number | null }>> {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT raw_payload, ingestion_id FROM raw_records rr
       JOIN raw_ingestions ri ON ri.id = rr.ingestion_id
       WHERE ri.source = 'amazon' AND ri.source_type = 'business'
       ORDER BY rr.id DESC LIMIT 500`
    ).all() as Array<{ raw_payload: string; ingestion_id: number }>;
    const out: Array<{ asin: string; units: number | null; revenue: number | null }> = [];
    const missingInsert = db.prepare(
      `INSERT INTO missing_data_items (research_job_id, entity_type, entity_id, field, missing_reason, required_for_decision, manual_validation_required, status, created_at)
       VALUES (?, 'raw_ingestion', ?, ?, '源报表该字段为空', 0, 0, 'open', ?)`
    );
    for (const r of rows) {
      const p = JSON.parse(r.raw_payload) as Record<string, string>;
      const asin = p['asin'] ?? p['ASIN'];
      if (!asin) continue;
      const units = toNumber(cleanCell(p['unitsOrdered'] ?? p['已订购商品数量'] ?? p['units'] ?? ''));
      const rev = toNumber(cleanCell(p['orderedProductSales'] ?? p['商品销售额'] ?? p['revenue'] ?? ''));
      if (units === null) missingInsert.run(null, r.ingestion_id, 'units', new Date().toISOString());
      if (rev === null) missingInsert.run(null, r.ingestion_id, 'revenue', new Date().toISOString());
      if (units !== null || rev !== null) out.push({ asin, units, revenue: rev });
    }
    return out;
  }

  // ===== OwnedBusinessProvider：从真实导入报表只读 =====
  async getOwnedProducts(): Promise<Array<{ sku: string; asin: string; title: string; marketplace: string }>> {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT raw_payload, ri.marketplace FROM raw_records rr
       JOIN raw_ingestions ri ON ri.id = rr.ingestion_id
       WHERE ri.source = 'amazon' AND ri.source_type = 'inventory'
       ORDER BY rr.id DESC LIMIT 1000`
    ).all() as Array<{ raw_payload: string; marketplace: string }>;
    const seen = new Map<string, { sku: string; asin: string; title: string }>();
    for (const r of rows) {
      const p = JSON.parse(r.raw_payload) as Record<string, string>;
      const asin = cleanCell(p['asin'] ?? p['ASIN'] ?? '');
      const sku = cleanCell(p['sku'] ?? p['SKU'] ?? '');
      if (!asin && !sku) continue;
      const title = cleanCell(p['product-name'] ?? p['商品名称'] ?? '') ?? asin ?? sku;
      seen.set((asin || sku) ?? '', { sku: sku ?? '', asin: asin ?? '', title: title ?? '' });
    }
    return [...seen.values()].map((x) => ({ ...x, marketplace: 'US' }));
  }

  async getOrders(range: { from: string; to: string }): Promise<Array<{ asin: string; date: string; units: number; revenue: number }>> {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT raw_payload FROM raw_records rr
       JOIN raw_ingestions ri ON ri.id = rr.ingestion_id
       WHERE ri.source = 'amazon' AND ri.source_type = 'business'
       ORDER BY rr.id DESC LIMIT 2000`
    ).all() as Array<{ raw_payload: string }>;
    const out: Array<{ asin: string; date: string; units: number; revenue: number }> = [];
    for (const r of rows) {
      const p = JSON.parse(r.raw_payload) as Record<string, string>;
      const asin = cleanCell(p['asin'] ?? p['ASIN'] ?? '');
      if (!asin) continue;
      const date = cleanCell(p['date'] ?? p['日期'] ?? '') ?? '';
      if (date && (date < range.from || date > range.to)) continue;
      const units = toNumber(cleanCell(p['unitsOrdered'] ?? p['已订购商品数量'] ?? p['units'] ?? ''));
      const rev = toNumber(cleanCell(p['orderedProductSales'] ?? p['商品销售额'] ?? p['revenue'] ?? ''));
      if (units !== null || rev !== null) out.push({ asin, date, units: units ?? 0, revenue: rev ?? 0 });
    }
    return out;
  }

  async getInventory(): Promise<Array<{ asin: string; units: number }>> {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT raw_payload FROM raw_records rr
       JOIN raw_ingestions ri ON ri.id = rr.ingestion_id
       WHERE ri.source = 'amazon' AND ri.source_type = 'inventory'
       ORDER BY rr.id DESC LIMIT 1000`
    ).all() as Array<{ raw_payload: string }>;
    const seen = new Map<string, number>();
    for (const r of rows) {
      const p = JSON.parse(r.raw_payload) as Record<string, string>;
      const asin = cleanCell(p['asin'] ?? p['ASIN'] ?? '');
      const qty = toNumber(cleanCell(p['quantity-available'] ?? p['可售数量'] ?? ''));
      if (asin && qty !== null) seen.set(asin, qty);
    }
    return [...seen.entries()].map(([asin, units]) => ({ asin, units }));
  }

  async getListingStatus(): Promise<Array<{ asin: string; status: string }>> {
    const db = getDatabase();
    const rows = db.prepare(
      `SELECT raw_payload FROM raw_records rr
       JOIN raw_ingestions ri ON ri.id = rr.ingestion_id
       WHERE ri.source = 'amazon' AND ri.source_type = 'inventory'
       ORDER BY rr.id DESC LIMIT 1000`
    ).all() as Array<{ raw_payload: string }>;
    const seen = new Map<string, string>();
    for (const r of rows) {
      const p = JSON.parse(r.raw_payload) as Record<string, string>;
      const asin = cleanCell(p['asin'] ?? p['ASIN'] ?? '');
      const qty = toNumber(cleanCell(p['quantity-available'] ?? p['可售数量'] ?? ''));
      if (asin) seen.set(asin, qty !== null && qty > 0 ? 'ACTIVE' : 'INACTIVE');
    }
    return [...seen.entries()].map(([asin, status]) => ({ asin, status }));
  }
}

export const amazonImport = new AmazonImportProvider();
