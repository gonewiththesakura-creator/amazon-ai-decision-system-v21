/* Amazon AI 决策中心 V2.1 — 前端应用（原生 JS，无构建链） */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 1 }));
const pct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`);

/** V2.1：全局模式横幅（DEMO/REAL/HYBRID 三态） */
async function refreshModeBanner() {
  try {
    const m = await api('/system/mode');
    const banner = $('#mode-banner');
    const map = {
      DEMO: ['demo', 'DEMO 模式 — 全部 Mock，仅限开发/测试/首次演示，严禁作为真实业务结论'],
      REAL: ['real', 'REAL 模式 — 真实数据优先，缺数据时任务进入 needs_data，禁止 Mock 兜底'],
      HYBRID: ['hybrid', 'HYBRID 模式 — 部分真实 + 部分假设，逐字段标注 REAL/ESTIMATED/ASSUMPTION/MOCK'],
    };
    const [cls, txt] = map[m.mode] ?? ['demo', m.label];
    banner.className = `mode-banner ${cls}`;
    banner.textContent = txt;
  } catch { /* 忽略 */ }
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

const statusChip = (s) => {
  const map = {
    draft: ['gray', '草稿'], planned: ['blue', '已计划'], collecting: ['blue', '采集中'],
    normalizing: ['blue', '标准化中'], validating: ['blue', '校验中'], calculating: ['blue', '计算中'],
    analyzing: ['blue', 'AI 分析中'], reverse_review: ['blue', '反向审查中'],
    waiting_approval: ['yellow', '待审批'], approved: ['green', '已批准'], watch: ['blue', '继续观察'],
    rejected: ['red', '已拒绝'], monitor_ready: ['green', '可监控'], monitoring: ['green', '监控中'], failed: ['red', '失败'], needs_data: ['yellow', '缺数据'],
  };
  const [c, l] = map[s] ?? ['gray', s];
  return `<span class="chip ${c}">${l}</span>`;
};

const spark = (values, w = 120, h = 34) => {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '<span class="muted">—</span>';
  const min = Math.min(...v), max = Math.max(...v);
  const range = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * (w - 4) + 2},${h - 3 - ((x - min) / range) * (h - 8)}`).join(' ');
  const up = v[v.length - 1] >= v[0];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${up ? '#2f7d4f' : '#b3402f'}" stroke-width="1.5"/></svg>`;
};

/* ===== 导航 ===== */
const views = {};
async function navigate() {
  const hash = location.hash || '#/';
  const [path, param] = hash.slice(2).split('/');
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === (path || 'dashboard')));
  const view = views[path] || views.dashboard;
  const main = $('#main');
  main.innerHTML = '<div class="empty">加载中…</div>';
  try {
    main.innerHTML = await view(param);
  } catch (e) {
    main.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', () => {
  navigate();
  refreshModeBanner();
  api('/ai/status').then((s) => {
    $('#ai-status').textContent = `AI 模式：${s.mode === 'llm' ? s.model : '确定性规则'} · ${s.system_mode ?? ''}`;
  }).catch(() => {});
});

/* ===== 今日简报 ===== */
views.dashboard = async () => {
  const b = await api('/dashboard/briefing');
  const cards = [
    ['风险项', b.counts.risks, 'red'], ['机会项', b.counts.opportunities, 'green'],
    ['待审批', b.counts.pending_approvals, 'yellow'], ['缺数据', b.counts.missing_data, 'gray'],
  ].map(([l, v, c]) => `<div class="card stat"><div class="v" style="color:var(--${c})">${v}</div><div class="l">${l}</div></div>`).join('');
  const items = b.items.map((i) => `
    <div class="card" style="cursor:pointer" onclick="${i.research_job_id ? `location.hash='#/jobs/${i.research_job_id}'` : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="chip ${i.status.includes('跑输') || i.status.includes('下滑') || i.status.includes('风险') ? 'red' : i.status.includes('增长') || i.status.includes('跑赢') ? 'green' : 'gray'}">${esc(i.status)}</span>
        <span class="muted" style="font-size:11px">${esc(i.entity_type)} · ${esc(i.source_job ?? '')}</span>
      </div>
      <div style="margin-top:8px;font-size:13.5px">${esc(i.summary)}</div>
      <div class="muted" style="margin-top:6px;font-family:var(--mono);font-size:11.5px">置信度 ${(i.confidence * 100).toFixed(0)}% · 可追溯</div>
    </div>`).join('');
  return `
    <div class="page-head">
      <div class="page-title">今日 AI 简报</div>
      <div class="page-desc">每条来自真实 Research Job / Snapshot / Rule / Insight，可点击追溯</div>
    </div>
    <div class="grid grid-4">${cards}</div>
    <div style="height:14px"></div>
    ${items || '<div class="card empty">暂无结论，请先在「研究任务」运行一个任务</div>'}`;
};

/* ===== 研究任务 ===== */
views.jobs = async (param) => {
  if (param) return renderJobDetail(Number(param));
  const jobs = await api('/research-jobs');
  const rows = jobs.map((j) => `
    <tr>
      <td><a class="link" href="#/jobs/${j.id}">${esc(j.name)}</a></td>
      <td><span class="chip gray">${esc(j.job_type)}</span></td>
      <td>${statusChip(j.status)}</td>
      <td class="muted">${esc(j.marketplace)}</td>
      <td class="num muted">${j.started_at ? new Date(j.started_at).toLocaleString('zh-CN') : '—'}</td>
      <td><button class="btn sm primary" onclick="runJob(${j.id})">运行</button></td>
    </tr>`).join('');
  return `
    <div class="page-head">
      <div class="page-title">研究任务</div>
      <div class="page-desc">任何一次研究都是一个正式任务（Research Job），后台自动完成 采集 → 标准化 → 快照 → 规则 → AI → 证据 → 审批</div>
    </div>
    <div class="card"><table><thead><tr><th>任务</th><th>类型</th><th>状态</th><th>站点</th><th>开始</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
};
async function runJob(id) {
  const btn = event.target;
  btn.disabled = true; btn.textContent = '运行中…';
  try {
    const r = await api(`/research-jobs/${id}/run`, { method: 'POST' });
    alert(`任务完成，状态：${r.status}`);
    navigate();
  } catch (e) {
    alert('运行失败：' + e.message);
    btn.disabled = false; btn.textContent = '运行';
  }
}

async function renderJobDetail(id) {
  const j = await api(`/research-jobs/${id}`);
  const steps = j.steps.map((s) => `<div class="step ${s.status}"><span class="dot"></span><span class="st-name">${esc(s.step_type)}</span><span class="muted">${s.status === 'success' ? '✓' : s.status === 'failed' ? '✗' : s.status}</span>${s.error ? `<span class="st-err">${esc(s.error)}</span>` : ''}</div>`).join('');
  const insights = j.insights.map((i) => {
    let body = '';
    let structured = null;
    try { structured = JSON.parse(i.recommendations_json); } catch { /* ignore */ }
    if (i.insight_type === 'sku' && structured) {
      const causes = (structured.possible_causes || []).map((c) => `<li>${esc(c)}</li>`).join('');
      body = `<div class="i-body"><ul>${causes}</ul></div>`;
    } else if (i.insight_type === 'reverse_review' && structured) {
      const modes = (structured.top_failure_modes || []).map((m) => `<li><b>${esc(m.risk)}</b> · ${esc(m.severity)} · ${m.resolved ? '已排除' : '未排除'} → ${esc(m.required_action)}</li>`).join('');
      const unknowns = (structured.unknowns || []).map((u) => `<li>${esc(u)}</li>`).join('');
      body = `<div class="i-body"><div style="margin:6px 0 4px;font-weight:600;font-size:12.5px">失败模式（前 5）</div><ul>${modes}</ul><div style="margin:6px 0 4px;font-weight:600;font-size:12.5px">未知项</div><ul>${unknowns}</ul><div style="margin-top:6px;font-size:12.5px;color:var(--accent)">${esc(structured.recommendation ?? '')}</div></div>`;
    } else if (i.insight_type === 'market' && structured) {
      const opps = (structured.opportunities || []).map((o) => `<li>${esc(o)}</li>`).join('');
      const risks = (structured.risks || []).map((o) => `<li>${esc(o)}</li>`).join('');
      body = `<div class="i-body"><div style="font-weight:600;font-size:12.5px">机会</div><ul>${opps || '<li class="muted">无</li>'}</ul><div style="margin-top:6px;font-weight:600;font-size:12.5px">风险</div><ul>${risks || '<li class="muted">无</li>'}</ul></div>`;
    } else if (i.insight_type === 'review_gap' && structured) {
      const issues = (structured.issues || []).map((x) => `<li>${esc(x.issue)} · 频率 ${(x.frequency * 100).toFixed(0)}% · ${x.competitors_affected} 竞品 · ${esc(x.opportunity_level)}</li>`).join('');
      body = `<div class="i-body"><ul>${issues || '<li class="muted">无显著痛点</li>'}</ul></div>`;
    }
    const evs = j.evidence.filter((e) => {
      try { return JSON.parse(i.evidence_ids_json).includes(e.id); } catch { return false; }
    }).map((e) => `<div class="ev">${esc(e.claim)} <span class="calc">[${esc(e.calculation ?? '')} · ${esc(e.source)}]</span></div>`).join('');
    return `
      <div class="insight" style="border-color:${i.status.includes('跑输') || i.status.includes('下滑') ? 'var(--red)' : 'var(--accent)'}">
        <div class="i-head"><span class="chip ${i.status.includes('跑输') || i.status.includes('下滑') ? 'red' : 'green'}">${esc(i.status)}</span><span class="i-meta">${esc(i.model)} · 置信度 ${(i.confidence * 100).toFixed(0)}% · ${esc(i.prompt_version)}</span></div>
        <div class="i-summary">${esc(i.summary)}</div>
        ${body}
        ${evs ? `<div class="evidence-list"><div style="font-size:11px;color:var(--ink-3);letter-spacing:.06em">EVIDENCE / 证据链</div>${evs}</div>` : ''}
      </div>`;
  }).join('');

  const scores = (j.score_results || []).map((s) => {
    let b = null;
    try { b = JSON.parse(s.breakdown_json); } catch { /* ignore */ }
    if (!b) return '';
    const rows = [
      ['需求质量', b.demand_quality], ['竞争可进入性', b.competition_entry],
      ['利润与现金效率', b.profit_cash_efficiency], ['供应链适配度', b.supply_chain_fit], ['风险可控性', b.risk_control],
    ].map(([label, v]) => `
      <div class="score-row"><span class="s-label">${label}</span><span class="s-bar"><div style="width:${(v.score / v.max) * 100}%"></div></span><span class="s-val">${v.score}/${v.max}</span></div>
      <div class="score-sub">${v.sub ? Object.values(v.sub).map((x) => `${x.score}/${x.max} · ${esc(x.note)}`).join('；') : esc(v.note)}</div>`).join('');
    return `<div class="card"><div class="card-title">机会评分：<span style="font-family:var(--mono)">${s.total_score} / ${b.max}</span> <span class="hint">（V2 评分体系，可展开子项）</span></div>${rows}</div>`;
  }).join('');

  const missingRows = (j.missing_data || []).map((m) => `<tr><td class="num">${esc(m.field)}</td><td class="muted">${esc(m.missing_reason)}</td><td>${m.required_for_decision ? '<span class="chip red">决策必需</span>' : '<span class="chip gray">参考</span>'}</td></tr>`).join('');
  const approvalPanel = j.status === 'waiting_approval' ? `
    <div class="card" style="border-color:var(--yellow)">
      <div class="card-title">审批面板 <span class="chip yellow">等待人工审批</span></div>
      <div class="muted" style="margin-bottom:10px;font-size:12.5px">重大业务动作不自动执行。请确认事实后做出决定，决定将写入决策日志。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" onclick="decide(${j.id},'approve')">批准下一阶段</button>
        <button class="btn" onclick="decide(${j.id},'watch')">继续观察</button>
        <button class="btn" onclick="decide(${j.id},'reject')">拒绝</button>
      </div>
    </div>` : '';

  const decisions = (j.decisions || []).map((d) => `<tr><td><span class="chip ${d.decision === 'approved' ? 'green' : d.decision === 'rejected' ? 'red' : 'blue'}">${esc(d.decision)}</span></td><td>${esc(d.decided_by)}</td><td class="muted">${esc(d.reason ?? '')}</td><td class="num muted">${new Date(d.decided_at).toLocaleString('zh-CN')}</td></tr>`).join('');

  return `
    <div class="page-head">
      <div class="page-title">${esc(j.name)}</div>
      <div class="page-desc"><span class="chip gray">${esc(j.job_type)}</span> ${statusChip(j.status)} <span class="muted">· ${esc(j.marketplace)} · 目标：${esc(j.target)}</span></div>
      <div class="page-actions">
        ${['draft', 'failed', 'needs_data', 'planned'].includes(j.status) ? `<button class="btn primary" onclick="runJob(${j.id})">运行</button>` : ''}
        ${j.status === 'failed' || j.status === 'needs_data' ? `<button class="btn" onclick="retryJob(${j.id})">重试</button>` : ''}
      </div>
    </div>
    ${approvalPanel}
    <div class="grid grid-2">
      <div class="card"><div class="card-title">工作流步骤</div><div class="steps">${steps}</div></div>
      <div>
        <div class="card"><div class="card-title">AI 结论 <span class="hint">结论 → 证据 → 原始数据 → Research Job，全部可追溯</span></div>${insights || '<div class="muted" style="font-size:13px">尚无 AI 结论，运行任务后生成</div>'}</div>
      </div>
    </div>
    ${scores}
    ${missingRows ? `<div class="card"><div class="card-title">缺失数据（Missing Data Queue）</div><table><thead><tr><th>字段</th><th>原因</th><th>级别</th></tr></thead><tbody>${missingRows}</tbody></table></div>` : ''}
    ${decisions ? `<div class="card"><div class="card-title">决策记录（Decision Log）</div><table><thead><tr><th>决定</th><th>决策人</th><th>理由</th><th>时间</th></tr></thead><tbody>${decisions}</tbody></table></div>` : ''}`;
}
async function retryJob(id) {
  try {
    const r = await api(`/research-jobs/${id}/retry`, { method: 'POST' });
    alert(`重试完成，状态：${r.status}`);
    navigate();
  } catch (e) { alert('重试失败：' + e.message); }
}
async function decide(id, action) {
  const reason = action === 'reject' ? (prompt('拒绝理由：') || '人工拒绝') : prompt(`（可选）备注：`) || undefined;
  try {
    await api(`/research-jobs/${id}/${action}`, { method: 'POST', body: JSON.stringify({ decided_by: '老板', reason }) });
    alert('已记录决策');
    navigate();
  } catch (e) { alert('操作失败：' + e.message); }
}

/* ===== 市场 ===== */
views.markets = async () => {
  const markets = await api('/markets');
  const main = markets.find((m) => m.name === 'Memory Foam Pillow');
  const children = markets.filter((m) => m.parent_id === main?.id);
  const renderNode = (m, depth) => {
    const kids = markets.filter((x) => x.parent_id === m.id);
    const snaps = [];
    const label = `<div class="node-label"><span class="nm">${esc(m.name)}</span></div>`;
    return `<div class="node" style="margin-left:${depth * 16}px">${label}${kids.map((k) => renderNode(k, depth + 1)).join('')}</div>`;
  };
  const treeHtml = main ? renderNode(main, 0) : '<div class="muted">先运行市场诊断任务以建立市场树</div>';
  const detail = main ? await api(`/markets/${main.id}`) : null;
  const trend = detail?.snapshots ? spark(detail.snapshots.map((s) => s.monthly_sales)) : '—';
  const insights = (detail?.insights || []).slice(0, 1).map((i) => `<div class="insight"><div class="i-head"><span class="chip green">${esc(i.status)}</span><span class="i-meta">${esc(i.model)} · 置信度 ${(i.confidence * 100).toFixed(0)}%</span></div><div class="i-summary">${esc(i.summary)}</div></div>`).join('');
  const latest = detail?.snapshots?.slice(-1)[0];
  const stats = [
    ['月销量', fmt(latest?.monthly_sales)], ['月销售额 $', fmt(latest?.monthly_revenue)],
    ['产品数', fmt(latest?.product_count)], ['平均售价 $', fmt(latest?.avg_price)],
    ['TOP10 集中度', latest?.top10_sales_share != null ? (latest.top10_sales_share * 100).toFixed(0) + '%' : '—'],
    ['评论中位数', fmt(latest?.median_reviews)],
  ].map(([l, v]) => `<div class="card stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const childRows = children.map((c) => {
    const s = c.snapshots || [];
    return `<tr><td><a class="link" href="#/markets/${c.id}">${esc(c.name)}</a></td></tr>`;
  }).join('');
  return `
    <div class="page-head"><div class="page-title">记忆棉枕头市场诊断</div><div class="page-desc">市场树 · 趋势 · 结构 · 价格带 —— 回答"我们所在的市场到底在涨还是跌"</div></div>
    <div class="grid grid-3">${stats}</div>
    <div style="height:14px"></div>
    <div class="grid grid-2">
      <div class="card"><div class="card-title">市场树（MarketNode）</div><div class="tree">${treeHtml}</div></div>
      <div>
        <div class="card"><div class="card-title">销量趋势 <span class="hint">近 180 天快照</span></div>${trend}</div>
        <div class="card" style="margin-top:14px"><div class="card-title">AI 市场结论</div>${insights || '<div class="muted">运行市场诊断任务后生成</div>'}</div>
      </div>
    </div>`;
};

/* ===== 自有 SKU ===== */
views.owned = async (param) => {
  const list = await api('/owned-products');
  const cards = list.map((o) => {
    const i = o.latest_insight;
    const chip = i ? (i.status.includes('跑输') ? 'red' : i.status.includes('跑赢') ? 'green' : 'blue') : 'gray';
    return `
    <div class="card" style="cursor:pointer" onclick="showOwnedDetail(${o.id})">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:600">${esc(o.sku)} · ${esc(o.internal_name)}</div>
        <span class="chip ${chip}">${i ? esc(i.status) : '未诊断'}</span>
      </div>
      <div class="muted" style="font-family:var(--mono);font-size:11.5px;margin-top:2px">${esc(o.asin)} · ${esc(o.market_name ?? '未关联市场')}</div>
      <div style="margin-top:8px;font-size:13px">${i ? esc(i.summary) : '尚未运行诊断任务'}</div>
      ${i ? `<div class="muted" style="margin-top:6px;font-family:var(--mono);font-size:11.5px">相对表现 ${esc(i.status)} · 置信度 ${(i.confidence * 100).toFixed(0)}%</div>` : ''}
    </div>`;
  }).join('');
  return `
    <div class="page-head"><div class="page-title">自有 4 SKU 战情室</div><div class="page-desc">谁跑赢市场、谁跑输市场、直接竞品最近发生了什么</div></div>
    <div class="grid grid-2">${cards || '<div class="card empty">尚未录入自有 SKU</div>'}</div>`;
};
async function showOwnedDetail(id) {
  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.innerHTML = '<div class="empty">加载中…</div><button class="drawer-close" onclick="this.parentElement.remove()">×</button>';
  document.body.appendChild(drawer);
  try {
    const [o, comps] = await Promise.all([api(`/owned-products/${id}`), api(`/owned-products/${id}/competitors`)]);
    const i = o.insights[0];
    let structured = null;
    try { structured = JSON.parse(i?.recommendations_json); } catch { /* ignore */ }
    const causes = structured?.possible_causes?.map((c) => `<li>${esc(c)}</li>`).join('') || '';
    const compRows = comps.slice(0, 12).map((c) => {
      const p = c.product, s = c.latest_snapshot;
      return `<tr><td class="num">${esc(p?.asin ?? '')}</td><td>${esc((p?.title ?? '').slice(0, 30))}</td><td><span class="chip gray">${esc(c.relation.type)}</span></td><td class="num">${fmt(s?.price)}</td><td class="num">${fmt(s?.review_count)}</td><td class="num">${fmt(s?.estimated_sales)}</td></tr>`;
    }).join('');
    drawer.innerHTML = `
      <button class="drawer-close" onclick="this.parentElement.remove()">×</button>
      <h3>${esc(o.sku)} · ${esc(o.internal_name)}</h3>
      <div class="muted" style="font-family:var(--mono);font-size:12px;margin-bottom:14px">${esc(o.asin)} · ${esc(o.market_name ?? '未关联市场')}</div>
      ${i ? `<div class="insight"><div class="i-head"><span class="chip ${i.status.includes('跑输') ? 'red' : 'green'}">${esc(i.status)}</span><span class="i-meta">${esc(i.model)} · 置信度 ${(i.confidence * 100).toFixed(0)}%</span></div><div class="i-summary">${esc(i.summary)}</div><div class="i-body"><ul>${causes}</ul></div></div>` : ''}
      <div class="card-title">竞品分组（direct / top100 / benchmark / fast_growth）</div>
      <table><thead><tr><th>ASIN</th><th>标题</th><th>分组</th><th>价格</th><th>评论</th><th>月销</th></tr></thead><tbody>${compRows}</tbody></table>`;
  } catch (e) {
    drawer.innerHTML = `<button class="drawer-close" onclick="this.parentElement.remove()">×</button><h3>加载失败</h3><div>${esc(e.message)}</div>`;
  }
}

/* ===== 机会池 ===== */
views.opportunities = async () => {
  const list = await api('/opportunities');
  const rows = list.map((o) => `
    <tr>
      <td><b>${esc(o.name)}</b></td>
      <td><span class="chip gray">${esc(o.source_type)}</span></td>
      <td class="num">${o.opportunity_score ?? '—'}</td>
      <td>${o.hard_gate_status ? `<span class="chip ${o.hard_gate_status === 'pass' ? 'green' : o.hard_gate_status === 'reject' ? 'red' : 'yellow'}">${esc(o.hard_gate_status)}</span>` : '—'}</td>
      <td>${statusChip(o.status)}</td>
      <td class="muted" style="max-width:260px">${esc(o.summary ?? '')}</td>
      <td>
        <button class="btn sm" onclick="oppAction(${o.id},'promote')">转开发</button>
        <button class="btn sm danger" onclick="oppAction(${o.id},'reject')">放弃</button>
      </td>
    </tr>`).join('');
  return `
    <div class="page-head"><div class="page-title">机会池 / 淘汰池</div><div class="page-desc">AI 发现的机会不自动立项；放弃的项目不删除，保留当时数据与判断，条件变化可重新评估</div></div>
    <div class="card"><table><thead><tr><th>机会</th><th>来源</th><th>评分</th><th>硬门槛</th><th>状态</th><th>摘要</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted" style="text-align:center">暂无机会</td></tr>'}</tbody></table></div>`;
};
async function oppAction(id, action) {
  const reason = action === 'reject' ? (prompt('放弃理由：') || '') : undefined;
  try {
    await api(`/opportunities/${id}/${action}`, { method: 'POST', body: JSON.stringify({ reason }) });
    navigate();
  } catch (e) { alert('操作失败：' + e.message); }
}

/* ===== 决策记录 / 缺失数据 / 数据任务 ===== */
views.decisions = async () => {
  const list = await api('/decisions');
  const rows = list.map((d) => `
    <tr><td><span class="chip ${d.decision === 'approved' ? 'green' : d.decision === 'rejected' ? 'red' : 'blue'}">${esc(d.decision)}</span></td>
    <td>${esc(d.decided_by)}</td><td class="muted">${esc(d.reason ?? '')}</td>
    <td class="num muted">${new Date(d.decided_at).toLocaleString('zh-CN')}</td></tr>`).join('');
  return `
    <div class="page-head"><div class="page-title">决策记录</div><div class="page-desc">人的决定单独保存，禁止只存在聊天文本中</div></div>
    <div class="card"><table><thead><tr><th>决定</th><th>决策人</th><th>理由</th><th>时间</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted" style="text-align:center">暂无决策记录</td></tr>'}</tbody></table></div>`;
};

views.missing = async () => {
  const list = await api('/missing-data');
  const grouped = {};
  list.forEach((m) => { (grouped[m.entity_type] = grouped[m.entity_type] || []).push(m); });
  const sections = Object.entries(grouped).map(([type, items]) => `
    <div class="card"><div class="card-title">${esc(type)} <span class="hint">${items.length} 项</span></div>
    <table><thead><tr><th>字段</th><th>原因</th><th>级别</th><th>需人工验证</th></tr></thead>
    <tbody>${items.map((m) => `<tr><td class="num">${esc(m.field)}</td><td class="muted">${esc(m.missing_reason)}</td><td>${m.required_for_decision ? '<span class="chip red">决策必需</span>' : '<span class="chip gray">参考</span>'}</td><td>${m.manual_validation_required ? '是' : '—'}</td></tr>`).join('')}</tbody></table></div>`).join('');
  return `
    <div class="page-head"><div class="page-title">缺失数据中心</div><div class="page-desc">不要让"缺数据"散落在 AI 文本里；缺失不补 0，如实登记</div></div>
    ${sections || '<div class="card empty">无缺失数据</div>'}`;
};

views.tasks = async () => {
  const list = await api('/data-tasks');
  const rows = list.map((t) => `
    <tr><td class="num">#${t.id}</td><td>${esc(t.task_type)}</td><td class="muted">${esc(t.target ?? '')}</td>
    <td>${statusChip(t.status)}</td><td class="num">${fmt(t.total)}</td><td class="num trend-up">${fmt(t.success)}</td><td class="num trend-down">${fmt(t.failed)}</td>
    <td class="muted">${esc(t.error_log ?? '')}</td></tr>`).join('');
  return `
    <div class="page-head"><div class="page-title">数据任务中心</div><div class="page-desc">采集任务执行记录与重试入口</div></div>
    <div class="card"><table><thead><tr><th>#</th><th>类型</th><th>目标</th><th>状态</th><th>总数</th><th>成功</th><th>失败</th><th>错误</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="muted" style="text-align:center">暂无任务</td></tr>'}</tbody></table></div>`;
};

window.runJob = runJob;
window.retryJob = retryJob;
window.decide = decide;
window.showOwnedDetail = showOwnedDetail;
window.oppAction = oppAction;

/* ===== V2.1 数据源与覆盖度 ===== */
views.data = async () => {
  const [mode, st, cov, imports, queue, conflicts] = await Promise.all([
    api('/system/mode'), api('/providers/status'), api('/dashboard/coverage'),
    api('/imports'), api('/mapping-queue'), api('/conflicts'),
  ]);
  const covRow = (k, v) => `
    <tr><td><b>${esc(k)}</b></td>
    <td><span class="chip ${v.status === 'MISSING' ? 'red' : v.status === 'ESTIMATED' || v.status === 'PARTIAL' ? 'yellow' : 'green'}">${esc(v.status)}</span></td>
    <td class="muted">${esc(v.detail)}</td></tr>`;
  const provRows = st.providers.map((p) => `
    <tr>
      <td>${p.isMock ? '<span class="chip red">MOCK</span>' : ''} <b>${esc(p.provider)}</b></td>
      <td><span class="chip ${p.status === 'Connected' ? 'green' : p.status === 'Unauthorized' ? 'yellow' : 'red'}">${esc(p.status)}</span></td>
      <td class="muted">${esc(p.detail)}</td>
      <td class="muted" style="font-size:11px">${p.capabilities.join(', ')}</td>
    </tr>`).join('');
  const impRows = imports.map((i) => `
    <tr>
      <td class="muted">#${i.id}</td>
      <td>${esc(i.source)} / ${esc(i.source_type)}</td>
      <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(i.source_file ?? '')}</td>
      <td class="num">${i.row_count}</td>
      <td><span class="chip ${i.mode === 'REAL' ? 'green' : 'yellow'}">${esc(i.mode)}</span></td>
      <td class="muted">${new Date(i.created_at).toLocaleString('zh-CN')}</td>
    </tr>`).join('');
  const queueRows = queue.map((q) => `
    <tr><td>${esc(q.source)}</td><td><b>${esc(q.source_column)}</b></td><td class="muted">${esc(q.sample_value ?? '')}</td>
    <td><span class="chip yellow">待映射</span></td></tr>`).join('');
  const confRows = conflicts.map((c) => `
    <tr>
      <td>${esc(c.entity_type)}#${c.entity_id} · ${esc(c.metric)}</td>
      <td>${esc(c.source_a)}: <b>${c.value_a}</b></td>
      <td>${esc(c.source_b)}: <b>${c.value_b}</b></td>
      <td class="num">${pct(c.variance_pct)}</td>
    </tr>`).join('');
  const modeBtns = ['DEMO', 'REAL', 'HYBRID'].map((m) =>
    `<button class="btn sm ${mode.mode === m ? 'primary' : ''}" onclick="setMode('${m}')">${m}</button>`).join('');
  return `
    <div class="page-head"><div class="page-title">数据源与真实数据覆盖度</div>
      <div class="page-desc">V2.1 真实数据优先 — 模式切换：${modeBtns}（当前 ${esc(mode.mode)}）</div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">REAL DATA COVERAGE（§42）</div>
        <table><thead><tr><th>数据域</th><th>状态</th><th>说明</th></tr></thead>
        <tbody>
          ${covRow('Market', cov.coverage.market)}
          ${covRow('Owned Sales', cov.coverage.owned_sales)}
          ${covRow('Competitor Sales', cov.coverage.competitor_sales)}
          ${covRow('Ads', cov.coverage.ads)}
          ${covRow('Supply Chain', cov.coverage.supply_chain)}
        </tbody></table>
      </div>
      <div class="card">
        <div class="card-title">Provider 状态（§14）</div>
        <table><thead><tr><th>Provider</th><th>状态</th><th>说明</th><th>能力</th></tr></thead>
        <tbody>${provRows}</tbody></table>
      </div>
    </div>
    <div style="height:14px"></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">真实导入批次（raw_ingestions）</div>
        <table><thead><tr><th>#</th><th>来源</th><th>文件</th><th>行数</th><th>模式</th><th>时间</th></tr></thead>
        <tbody>${impRows || '<tr><td colspan="6" class="muted" style="text-align:center">尚未导入真实文件</td></tr>'}</tbody></table>
      </div>
      <div class="card">
        <div class="card-title">Conflicting Data（§21 并存显示）</div>
        <table><thead><tr><th>实体/指标</th><th>来源A</th><th>来源B</th><th>Variance</th></tr></thead>
        <tbody>${confRows || '<tr><td colspan="4" class="muted" style="text-align:center">暂无冲突记录</td></tr>'}</tbody></table>
      </div>
    </div>
    <div style="height:14px"></div>
    <div class="card">
      <div class="card-title">Import Mapping Queue（§40 — 未映射列禁止静默丢弃）</div>
      <table><thead><tr><th>来源</th><th>未映射列</th><th>样例值</th><th>状态</th></tr></thead>
      <tbody>${queueRows || '<tr><td colspan="4" class="muted" style="text-align:center">无待映射列（真实 ReverseASIN 32 列全部映射成功）</td></tr>'}</tbody></table>
    </div>`;
};
window.setMode = async (m) => {
  try {
    await api('/system/mode', { method: 'POST', body: JSON.stringify({ mode: m }) });
    await refreshModeBanner();
    navigate();
  } catch (e) { alert('切换失败：' + e.message); }
};
