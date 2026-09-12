/**
 * 服务入口：Express + API + 静态 UI + 演示数据自动播种
 */
import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { getDatabase } from './db/connection.js';
import { seedDemo } from './seed/seed-demo.js';
import { registerAllProviders } from './adapters/providers/index.js';
import { getMode } from './config/mode.js';
import { api } from './api/routes.js';
import { api21 } from './api/routes-v21.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 加载 .env（Node 22 内置，无需 dotenv 依赖）
const envPath = resolve(__dirname, '../.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const PORT = Number(process.env.PORT ?? 3000);

// 初始化数据库 + 默认规则 + 演示数据 + Provider Registry
getDatabase();
seedDemo();
registerAllProviders();

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.text({ type: 'text/csv', limit: '20mb' }));

app.use('/api', api);
app.use('/api', api21);

// 静态 UI
app.use(express.static(resolve(__dirname, '../public')));
app.get('/', (_req, res) => {
  res.sendFile(resolve(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Amazon AI 决策系统 V2.1 已启动`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  数据模式：${getMode()} —— 详见 UI 顶部横幅；真实数据优先（V2.1）\n`);
});
