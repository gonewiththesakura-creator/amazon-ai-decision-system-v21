/**
 * 第三方估算校准（V2.1 §22）——利用自有 SKU 的 Amazon Actual vs SellerSprite Estimated
 * 计算 Bias / MAPE / Median Error，输出 CALIBRATED_ESTIMATE（绝不冒充真实销量）
 */
import { getDatabase } from '../../db/connection.js';

export interface CalibrationResult {
  provider: string;
  metric: string;
  sampleCount: number;
  bias: number;          // 平均偏差 %（正 = 高估）
  mape: number;          // 平均绝对百分比误差 %
  medianError: number;   // 中位误差 %
  windowDays: number;
}

/** 计算校准统计；pairs = [{actual, estimated}]（actual=Amazon 真实，estimated=第三方估算） */
export function computeCalibration(provider: string, metric: string, pairs: Array<{ actual: number; estimated: number }>, windowDays = 30): CalibrationResult {
  if (pairs.length === 0) throw new Error('校准需要至少 1 组 实际/估算 对照');
  const errors = pairs.map((p) => (p.actual === 0 ? 0 : ((p.estimated - p.actual) / p.actual) * 100));
  const sorted = [...errors].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const bias = errors.reduce((s, e) => s + e, 0) / errors.length;
  const mape = pairs.reduce((s, p) => s + (p.actual === 0 ? 0 : Math.abs(p.estimated - p.actual) / p.actual) * 100, 0) / pairs.length;
  const result: CalibrationResult = {
    provider,
    metric,
    sampleCount: pairs.length,
    bias: Math.round(bias * 10) / 10,
    mape: Math.round(mape * 10) / 10,
    medianError: Math.round(median * 10) / 10,
    windowDays,
  };
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO calibration_stats (provider, metric, sample_count, bias, mape, median_error, window_days, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, metric, window_days) DO UPDATE SET
       sample_count = excluded.sample_count, bias = excluded.bias, mape = excluded.mape,
       median_error = excluded.median_error, computed_at = excluded.computed_at`
  ).run(provider, metric, pairs.length, result.bias, result.mape, result.medianError, windowDays, now);
  return result;
}

/** 应用校准：估算值 → CALIBRATED_ESTIMATE */
export function applyCalibration(estimated: number, cal: CalibrationResult | null | undefined): { value: number; label: 'CALIBRATED_ESTIMATE'; rawEstimate: number } {
  if (!cal || cal.bias === 0) return { value: estimated, label: 'CALIBRATED_ESTIMATE', rawEstimate: estimated };
  const adjusted = estimated / (1 + cal.bias / 100);
  return { value: Math.round(adjusted), label: 'CALIBRATED_ESTIMATE', rawEstimate: estimated };
}

/** 读取最近一次校准 */
export function getCalibration(provider: string, metric: string, windowDays = 30): CalibrationResult | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT provider, metric, sample_count, bias, mape, median_error, window_days FROM calibration_stats WHERE provider = ? AND metric = ? AND window_days = ? ORDER BY id DESC LIMIT 1')
    .get(provider, metric, windowDays) as { provider: string; metric: string; sample_count: number; bias: number; mape: number; median_error: number; window_days: number } | undefined;
  if (!row) return null;
  return { provider: row.provider, metric: row.metric, sampleCount: row.sample_count, bias: row.bias, mape: row.mape, medianError: row.median_error, windowDays: row.window_days };
}

/** 记录 Source Conflict（V2.1 §21）——多源冲突并存，不自动覆盖 */
export function recordSourceConflict(params: {
  entityType: string;
  entityId: number;
  metric: string;
  sourceA: string;
  valueA: number;
  sourceB: string;
  valueB: number;
}): { id: number; variancePct: number } {
  const db = getDatabase();
  const variancePct = params.valueA === 0 ? 0 : Math.round(((params.valueB - params.valueA) / params.valueA) * 1000) / 10;
  const now = new Date().toISOString();
  const ins = db
    .prepare(
      `INSERT INTO source_conflicts (entity_type, entity_id, metric, source_a, value_a, source_b, value_b, variance_pct, resolution, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unresolved', ?)`
    )
    .run(params.entityType, params.entityId, params.metric, params.sourceA, params.valueA, params.sourceB, params.valueB, variancePct, now);
  return { id: Number(ins.lastInsertRowid), variancePct };
}
