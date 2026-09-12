/** CLI：npm run seed —— 重新生成演示数据（force） */
import { getDatabase } from '../db/connection.js';
import { seedDemo } from './seed-demo.js';

getDatabase();
seedDemo(true);
const db = getDatabase();
const owned = (db.prepare('SELECT COUNT(*) AS c FROM owned_products').get() as { c: number }).c;
const markets = (db.prepare('SELECT COUNT(*) AS c FROM markets').get() as { c: number }).c;
const jobs = (db.prepare('SELECT COUNT(*) AS c FROM research_jobs').get() as { c: number }).c;
const profiles = (db.prepare('SELECT COUNT(*) AS c FROM rule_profiles').get() as { c: number }).c;
console.log(`[seed] 完成：自有 SKU=${owned}，市场=${markets}，演示 Job=${jobs}，规则档案=${profiles}（全部为演示数据）`);
