/**
 * SellerSprite 真实文件导入引擎（V2.1 §1.1C / §9 / §10 / §12 / §40）
 * - 支持 xlsx / csv / tsv（UTF-8/GBK/BOM 自动识别）
 * - ReverseASIN 中文列 → 标准字段映射
 * - 原始数据落 raw_ingestions / raw_records（禁止只存清洗后数据）
 * - 映射关系落 normalization_mappings（可追溯）
 * - 未知列进 mapping_queue（禁止静默丢弃）
 * - 重复 ASIN/行不重复创建错误记录
 */
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import iconv from 'iconv-lite';
import { getDatabase } from '../../db/connection.js';
import type { SystemMode } from '../../config/mode.js';

/** 解析后的表格 */
export interface ParsedSheet {
  source_file: string;
  sheet_name: string;
  headers: string[];
  rows: Array<Record<string, string>>;
}

/** ReverseASIN 导出中文列 → 标准字段（V2.1 §10 示例映射之一） */
export const REVERSE_ASIN_COLUMN_MAP: Record<string, string> = {
  流量词: 'keyword',
  关键词翻译: 'keyword_translation',
  AC推荐词: 'ac_recommended_keyword',
  流量占比: 'traffic_share',
  预估周曝光量: 'estimated_weekly_impressions',
  关键词类型: 'keyword_type',
  转化效果: 'conversion_effect',
  流量词类型: 'traffic_type',
  自然流量占比: 'organic_traffic_share',
  广告流量占比: 'ad_traffic_share',
  自然排名: 'organic_rank',
  自然排名页码: 'organic_rank_page',
  更新时间: 'updated_at',
  广告排名: 'ad_rank',
  广告排名页码: 'ad_rank_page',
  ABA周排名: 'aba_weekly_rank',
  月搜索量: 'search_volume',
  SPR: 'spr',
  标题密度: 'title_density',
  购买量: 'purchases',
  购买率: 'purchase_rate',
  展示量: 'impressions',
  点击量: 'clicks',
  商品数: 'product_count',
  需供比: 'supply_demand_ratio',
  广告竞品数: 'ad_competitors',
  点击总占比: 'click_share',
  转化总占比: 'conversion_share',
  PPC价格: 'ppc_price',
  建议竞价范围: 'suggested_bid_range',
  前十ASIN: 'top10_asins',
};

/** 数字字段（需要数值化） */
const NUMERIC_FIELDS = new Set([
  'traffic_share', 'estimated_weekly_impressions', 'organic_traffic_share', 'ad_traffic_share',
  'organic_rank', 'aba_weekly_rank', 'search_volume', 'spr', 'title_density', 'purchases',
  'purchase_rate', 'impressions', 'clicks', 'product_count', 'supply_demand_ratio',
  'ad_competitors', 'click_share', 'conversion_share',
]);

/** 字符串清洗：NA / - / 空 → null */
export function cleanCell(v: string): string | null {
  const t = (v ?? '').trim();
  if (t === '' || t === 'NA' || t === 'N/A' || t === '-' || t === 'null' || t === 'NULL') return null;
  return t;
}

/** 数值化：'MX$0.02' → 0.02；'$0.63' → 0.63；'12%' → 12（保留百分号语义为数值）；'39,99' → 39.99 */
export function toNumber(v: string | null): number | null {
  if (v === null) return null;
  const cleaned = v.trim().replace(/,/g, '.');
  const m = cleaned.match(/[-+]?\d+(?:\.\d+)?/);
  if (!m) return null;
  return Number(m[0]);
}

/** 识别编码并读取文本（UTF-8 BOM / UTF-8 / GBK） */
function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  // 尝试 UTF-8 严格解码
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    if (!s.includes('\uFFFD')) return s;
  } catch {
    /* 非 UTF-8 */
  }
  return iconv.decode(buf, 'gbk');
}

/** CSV/TSV 解析（处理引号包裹） */
function parseDelimited(text: string, delimiter: ',' | '\t'): ParsedSheet {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('文件为空');
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delimiter) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]!).map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = cells[idx] ?? '';
    });
    rows.push(row);
  }
  return { source_file: '', sheet_name: 'csv', headers, rows };
}

/** 解析任意文件（xlsx / csv / tsv），返回行列 */
export async function parseImportFile(filePath: string): Promise<ParsedSheet> {
  const ext = extname(filePath).toLowerCase();
  const stat = statSync(filePath);
  if (stat.size === 0) throw new Error('文件为空');
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('xlsx 无工作表');
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => {
      headers[col] = String(c.value ?? '').trim();
    });
    const realHeaders = headers.filter((h) => h.length > 0);
    const rows: Array<Record<string, string>> = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row: Record<string, string> = {};
      let nonEmpty = false;
      ws.getRow(r).eachCell({ includeEmpty: true }, (c, col) => {
        const h = headers[col];
        if (h) {
          const v = String(c.value ?? '').trim();
          row[h] = v;
          if (v !== '') nonEmpty = true;
        }
      });
      if (nonEmpty) rows.push(row);
    }
    return { source_file: basename(filePath), sheet_name: ws.name, headers: realHeaders, rows };
  }
  if (ext === '.csv' || ext === '.tsv') {
    const buf = readFileSync(filePath);
    const text = decodeText(buf);
    const delimiter = ext === '.tsv' ? '\t' : ',';
    const parsed = parseDelimited(text, delimiter);
    parsed.source_file = basename(filePath);
    return parsed;
  }
  throw new Error(`不支持的文件类型: ${ext}（支持 xlsx/csv/tsv）`);
}

/** 导入结果 */
export interface ImportResult {
  ingestionId: number;
  source_file: string;
  row_count: number;
  mapped_columns: Array<{ source_column: string; standard_field: string }>;
  unmapped_columns: Array<{ source_column: string; sample_value: string }>;
  duplicate_rows: number;
}

/** 创建 raw_ingestions + raw_records（通用） */
export function storeRawFile(params: {
  source: string;
  source_type: string;
  source_file: string;
  mode: SystemMode;
  rawText?: string;
  records: Array<{ source_record_id?: string; record_type?: string; payload: Record<string, unknown> }>;
}): { ingestionId: number; payloadHash: string } {
  const db = getDatabase();
  const payloadHash = createHash('sha256')
    .update(params.rawText ?? JSON.stringify(params.records))
    .digest('hex')
    .slice(0, 16);
  const now = new Date().toISOString();
  const batchId = `batch-${Date.now()}`;
  const ins = db
    .prepare(
      `INSERT INTO raw_ingestions (source, source_type, source_file, endpoint, fetched_at, payload_hash, import_batch_id, mode, status, row_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`
    )
    .run(params.source, params.source_type, params.source_file, null, now, payloadHash, batchId, params.mode, params.records.length, now);
  const ingestionId = Number(ins.lastInsertRowid);
  const insertRecord = db.prepare(
    `INSERT INTO raw_records (ingestion_id, row_index, source_record_id, record_type, raw_payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  params.records.forEach((r, idx) => {
    insertRecord.run(ingestionId, idx, r.source_record_id ?? null, r.record_type ?? null, JSON.stringify(r.payload), now);
  });
  return { ingestionId, payloadHash };
}

/** ReverseASIN 文件导入（P0-1 验收主路径） */
export async function importReverseAsinFile(filePath: string, opts: { marketplace: string; asin: string; mode: SystemMode }): Promise<ImportResult> {
  const sheet = await parseImportFile(filePath);
  const db = getDatabase();

  // 1. 列映射：已知 → normalization_mappings；未知 → mapping_queue
  const mappedColumns: Array<{ source_column: string; standard_field: string }> = [];
  const unmappedColumns: Array<{ source_column: string; sample_value: string }> = [];
  const now = new Date().toISOString();
  const upsertMapping = db.prepare(
    `INSERT INTO normalization_mappings (source, source_type, source_column, standard_field, transform_formula, unit_conversion, lossy, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, source_type, source_column) DO UPDATE SET standard_field = excluded.standard_field`
  );
  const insertQueue = db.prepare(
    `INSERT INTO mapping_queue (ingestion_id, source, source_column, sample_value, suggested_field, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(source, source_column) DO NOTHING`
  );
  for (const h of sheet.headers) {
    const std = REVERSE_ASIN_COLUMN_MAP[h];
    if (std) {
      upsertMapping.run('sellersprite', 'reverse_asin', h, std, NUMERIC_FIELDS.has(std) ? 'toNumber(cleanCell)' : 'cleanCell', null, NUMERIC_FIELDS.has(std) ? 0 : 1, 'ReverseASIN 导出', now);
      mappedColumns.push({ source_column: h, standard_field: std });
    } else {
      const sample = sheet.rows.find((r) => (r[h] ?? '') !== '')?.[h] ?? '';
      insertQueue.run(null, 'sellersprite', h, sample.slice(0, 200), null, now);
      unmappedColumns.push({ source_column: h, sample_value: sample.slice(0, 200) });
    }
  }

  // 2. 原始行落库（保留完整原始值）
  const rawText = JSON.stringify(sheet.rows);
  const { ingestionId } = storeRawFile({
    source: 'sellersprite',
    source_type: 'reverse_asin',
    source_file: sheet.source_file,
    mode: opts.mode,
    rawText,
    records: sheet.rows.map((row, idx) => ({
      source_record_id: `${opts.asin}:${idx + 1}`,
      record_type: 'reverse_asin_keyword',
      payload: { marketplace: opts.marketplace, asin: opts.asin, ...row },
    })),
  });

  // 3. 写入 keywords / keyword_snapshots（标准字段；重复 keyword 不重复创建；同日快照覆盖更新）
  let duplicates = 0;
  const getOrCreateKeyword = db.prepare('SELECT id FROM keywords WHERE keyword = ? AND marketplace = ?');
  const insertKeyword = db.prepare('INSERT INTO keywords (market_id, keyword, marketplace, created_at) VALUES (?, ?, ?, ?)');
  const findSnap = db.prepare('SELECT id FROM keyword_snapshots WHERE keyword_id = ? AND date = ? ORDER BY id DESC LIMIT 1');
  const updateSnap = db.prepare(
    `UPDATE keyword_snapshots SET search_volume = ?, competing_products = ?, aba_click_share = ?, aba_conversion_share = ?, bid = ?,
       aba_weekly_rank = ?, clicks = ?, impressions = ?, purchases = ?, purchase_rate = ?, traffic_share = ?,
       source_metadata = ?, provenance = ? WHERE id = ?`
  );
  const insertSnap = db.prepare(
    `INSERT INTO keyword_snapshots (keyword_id, date, search_volume, competing_products, aba_click_share, aba_conversion_share, bid, aba_weekly_rank, clicks, impressions, purchases, purchase_rate, traffic_share, source_metadata, is_demo, provenance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  );
  for (const row of sheet.rows) {
    const keyword = cleanCell(row['流量词'] ?? '');
    if (!keyword) continue;
    const searchVolume = toNumber(cleanCell(row['月搜索量'] ?? ''));
    const competingProducts = toNumber(cleanCell(row['商品数'] ?? ''));
    const abaRank = toNumber(cleanCell(row['ABA周排名'] ?? ''));
    const clicks = toNumber(cleanCell(row['点击量'] ?? ''));
    const impressions = toNumber(cleanCell(row['展示量'] ?? ''));
    const purchases = toNumber(cleanCell(row['购买量'] ?? ''));
    const purchaseRate = toNumber(cleanCell(row['购买率'] ?? ''));
    const trafficShare = toNumber(cleanCell(row['流量占比'] ?? ''));
    const snapDate = now.slice(0, 10);
    const existing = getOrCreateKeyword.get(keyword, opts.marketplace) as { id: number } | undefined;
    let kid: number;
    if (existing) {
      duplicates++;
      kid = existing.id;
    } else {
      const r = insertKeyword.run(null, keyword, opts.marketplace, now);
      kid = Number(r.lastInsertRowid);
    }
    const existingSnap = findSnap.get(kid, snapDate) as { id: number } | undefined;
    const snapValues = [
      searchVolume, competingProducts, abaRank !== null ? abaRank / 100000 : null, null, null,
      abaRank, clicks, impressions, purchases, purchaseRate, trafficShare,
      JSON.stringify({ source: 'sellersprite_reverse_asin', asin: opts.asin, file: sheet.source_file }),
      opts.mode === 'DEMO' ? 'MOCK' : 'ESTIMATED',
    ];
    if (existingSnap) {
      updateSnap.run(...snapValues, existingSnap.id);
    } else {
      insertSnap.run(kid, snapDate, ...snapValues, now);
    }
  }

  return { ingestionId, source_file: sheet.source_file, row_count: sheet.rows.length, mapped_columns: mappedColumns, unmapped_columns: unmappedColumns, duplicate_rows: duplicates };
}
