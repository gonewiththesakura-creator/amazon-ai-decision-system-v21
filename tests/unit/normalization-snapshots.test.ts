import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openInMemory, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { normalizeMarketData, normalizeProductData, hasRequiredData } from '../../src/normalization/engine.js';
import { saveMarketSnapshot, saveMarketSnapshotSeries, listMarketSnapshots, upsertMarketNode, upsertProduct, saveProductSnapshotSeries, listProductSnapshots, growthFromSnapshots } from '../../src/modules/snapshots/engine.js';
import { snapshotDates } from '../../src/adapters/mock/mock-adapter.js';
import { rawMarket, rawProduct, rawMarketSnapshot, rawProductSnapshot } from '../helpers.js';

test('缺失数据：required 字段为 null → 记入队列且 hasRequiredData=false（禁止补 0）', () => {
  openInMemory();
  try {
    const r = normalizeMarketData(
      rawMarket({ market_name: 'Test Market', monthly_sales: null, product_count: null, avg_price: 29.9 }),
      { is_demo: false }
    );
    assert.ok(r.missing.some((m) => m.field === 'monthly_sales' && m.required_for_decision));
    assert.ok(r.missing.some((m) => m.field === 'product_count'));
    assert.equal(hasRequiredData(r.missing), false);
    const db = getDatabase();
    const stored = db.prepare("SELECT * FROM missing_data_items WHERE entity_type='market' AND entity_id=?").all(r.marketId);
    assert.ok(stored.length >= 2, '缺失项应落库');
    const snap = listMarketSnapshots(r.marketId);
    assert.ok(snap.length >= 1);
    assert.equal(snap[snap.length - 1]!.monthly_sales, null, '快照不得用 0 填充缺失值');
  } finally {
    closeDatabase();
  }
});

test('缺失数据：数据齐全 → hasRequiredData=true', () => {
  openInMemory();
  try {
    const r = normalizeMarketData(
      rawMarket({ market_name: 'Full Market', monthly_sales: 1000, product_count: 50, avg_price: 25 }),
      { is_demo: false }
    );
    assert.equal(hasRequiredData(r.missing), true);
  } finally {
    closeDatabase();
  }
});

test('快照：同一天重复写入被拒绝（历史不可覆盖，追加式）', () => {
  openInMemory();
  try {
    const m = upsertMarketNode({ name: 'Snap Market', marketplace: 'US', source: 'test' });
    const a = saveMarketSnapshot(m, rawMarket({ market_name: 'Snap Market', monthly_sales: 111, product_count: 10 }), { is_demo: false });
    const b = saveMarketSnapshot(m, rawMarket({ market_name: 'Snap Market', monthly_sales: 999, product_count: 10 }), { is_demo: false });
    assert.equal(a.inserted, true);
    assert.equal(b.inserted, false, '同日重复写入必须被跳过');
    const snaps = listMarketSnapshots(m);
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0]!.monthly_sales, 111, '原快照不得被覆盖');
  } finally {
    closeDatabase();
  }
});

test('快照序列：5 个不同日期各自落库且数值各异（回归修复：不得全部写同一个值）', () => {
  openInMemory();
  try {
    const m = upsertMarketNode({ name: 'Trend Market', marketplace: 'US', source: 'test' });
    const dates = snapshotDates([180, 90, 30, 7, 0]);
    const series = dates.map((date, i) =>
      rawMarketSnapshot({ date, monthly_sales: 1000 + i * 100, monthly_revenue: 30000 + i * 3000, product_count: 10 + i, avg_price: 30, median_price: 29 })
    );
    saveMarketSnapshotSeries(m, rawMarket({ market_name: 'Trend Market', snapshots: series }), { is_demo: false });
    const snaps = listMarketSnapshots(m);
    assert.equal(snaps.length, 5);
    const values = snaps.map((s) => s.monthly_sales);
    assert.ok(new Set(values).size === 5, `5 个快照数值应各不相同，实际 ${JSON.stringify(values)}`);
    const g = growthFromSnapshots(snaps.map((s) => ({ snapshot_date: s.snapshot_date, monthly_sales: s.monthly_sales })), 30);
    assert.ok(g != null && g > 0, '30 天窗口增速应可计算且为正');
  } finally {
    closeDatabase();
  }
});

test('产品快照序列：与市场序列同样逐日写入（Job2 回归根因）', () => {
  openInMemory();
  try {
    const m = upsertMarketNode({ name: 'Prod Trend Market', marketplace: 'US', source: 'test' });
    const p = upsertProduct({ asin: 'B0TEST0001', brand: 'T', title: 'Test Product', marketplace: 'US', market_id: m });
    const dates = snapshotDates([90, 30, 7, 0]);
    const raw = rawProduct({
      asin: 'B0TEST0001',
      market_name: 'Prod Trend Market',
      price: 29.9,
      rating: 4.3,
      review_count: 120,
      bsr: 8000,
      estimated_sales_30d: 620,
      snapshots: dates.map((date, i) => rawProductSnapshot({ date, price: 29.9, rating: 4.3, review_count: 120 - i * 5, bsr: 8000 + i, estimated_sales: 620 - i * 10 })),
    });
    saveProductSnapshotSeries(p, raw, { is_demo: false });
    const snaps = listProductSnapshots(p);
    assert.equal(snaps.length, 4);
    const sales = snaps.map((s) => s.estimated_sales);
    assert.ok(new Set(sales).size === 4, `4 个产品快照数值应各不相同，实际 ${JSON.stringify(sales)}`);
  } finally {
    closeDatabase();
  }
});

test('增速计算：30 天窗口应命中 30 天前的快照（而非最近一张）', () => {
  openInMemory();
  try {
    const m = upsertMarketNode({ name: 'Window Market', marketplace: 'US', source: 'test' });
    const dates = snapshotDates([90, 30, 7, 0]);
    const series = dates.map((date, i) => rawMarketSnapshot({ date, monthly_sales: [1000, 1100, 1200, 1300][i]! }));
    saveMarketSnapshotSeries(m, rawMarket({ market_name: 'Window Market', snapshots: series }), { is_demo: false });
    const snaps = listMarketSnapshots(m);
    // latest=1300，30 天前=1100 → 增速 ≈ 18.2%
    const g = growthFromSnapshots(snaps.map((s) => ({ snapshot_date: s.snapshot_date, monthly_sales: s.monthly_sales })), 30);
    assert.ok(g != null);
    assert.ok(Math.abs(g! - 18.2) < 1, `期望 ≈18.2%，实际 ${g}`);
  } finally {
    closeDatabase();
  }
});

test('标准化产品：仅录入产品不写 0，缺失字段如实记录', () => {
  openInMemory();
  try {
    const r = normalizeProductData(
      rawProduct({ asin: 'B0TEST0002', market_name: 'Window Market', price: 19.9, review_count: null, estimated_sales_30d: null }),
      { is_demo: false }
    );
    assert.ok(r.missing.some((m) => m.field === 'review_count'));
    assert.ok(r.missing.some((m) => m.field === 'estimated_sales_30d'));
  } finally {
    closeDatabase();
  }
});
