export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TokenWatch</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root {
    --bg: #0d1117; --card: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --red: #f85149; --amber: #d29922;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, 'Segoe UI', Roboto, sans-serif; }
  header { display: flex; align-items: center; gap: 16px; padding: 16px 24px; border-bottom: 1px solid var(--border); }
  header h1 { font-size: 18px; margin: 0; }
  header h1 span { color: var(--accent); }
  .spacer { flex: 1; }
  select, input, button { background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font: inherit; }
  button { cursor: pointer; } button:hover { border-color: var(--accent); }
  main { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .card .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  .card .value { font-size: 26px; font-weight: 600; margin-top: 4px; }
  .card .sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .budgetbar { height: 8px; background: var(--border); border-radius: 4px; margin-top: 8px; overflow: hidden; }
  .budgetbar > div { height: 100%; background: var(--green); }
  .grid2 { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-top: 12px; }
  .grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-top: 12px; }
  h2 { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .err { color: var(--red); }
  .ok { color: var(--green); }
  .chartbox { position: relative; height: 260px; }
  @media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>⏱ Token<span>Watch</span></h1>
  <div class="spacer"></div>
  <label>Period
    <select id="days">
      <option value="7">7 days</option>
      <option value="30" selected>30 days</option>
      <option value="90">90 days</option>
    </select>
  </label>
  <label>Budget $<input id="budget" type="number" min="0" step="10" style="width:90px"></label>
  <button id="saveBudget">Save</button>
</header>
<main>
  <div class="cards">
    <div class="card"><div class="label">Spend (period)</div><div class="value" id="spend">–</div><div class="sub" id="calls"></div></div>
    <div class="card"><div class="label">This month</div><div class="value" id="month">–</div><div class="sub" id="budgetState"></div><div class="budgetbar"><div id="budgetFill" style="width:0%"></div></div></div>
    <div class="card"><div class="label">Tokens</div><div class="value" id="tokens">–</div><div class="sub" id="tokensSplit"></div></div>
    <div class="card"><div class="label">Avg latency</div><div class="value" id="latency">–</div></div>
    <div class="card"><div class="label">Error rate</div><div class="value" id="errors">–</div><div class="sub" id="errorCount"></div></div>
  </div>

  <div class="grid2">
    <div class="card"><h2>Daily spend</h2><div class="chartbox"><canvas id="dailyChart"></canvas></div></div>
    <div class="card"><h2>By model</h2><div class="chartbox"><canvas id="modelChart"></canvas></div></div>
  </div>

  <div class="grid3">
    <div class="card"><h2>By feature</h2><table id="featureTable"></table></div>
    <div class="card"><h2>By customer</h2><table id="customerTable"></table></div>
  </div>

  <div class="card" style="margin-top:12px"><h2>Recent calls</h2><table id="recentTable"></table></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const usd = (v) => '$' + (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
const num = (v) => v >= 1e9 ? (v/1e9).toFixed(1)+'B' : v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : String(v);
let dailyChart, modelChart;

function fillTable(el, rows, nameHeader) {
  el.innerHTML = '<tr><th>' + nameHeader + '</th><th class="num">Cost</th><th class="num">Calls</th><th class="num">Tokens</th></tr>' +
    rows.map(r => '<tr><td>' + r.name + '</td><td class="num">' + usd(r.costUsd || 0) + '</td><td class="num">' + num(r.calls) + '</td><td class="num">' + num(r.tokens || 0) + '</td></tr>').join('');
}

async function load() {
  const days = $('days').value;
  const s = await (await fetch('/v1/stats?days=' + days)).json();
  const t = s.totals;

  $('spend').textContent = usd(t.costUsd);
  $('calls').textContent = num(t.calls) + ' calls';
  $('tokens').textContent = num(t.inputTokens + t.outputTokens);
  $('tokensSplit').textContent = num(t.inputTokens) + ' in / ' + num(t.outputTokens) + ' out';
  $('latency').textContent = t.avgLatencyMs ? Math.round(t.avgLatencyMs) + ' ms' : '–';
  const errRate = t.calls ? (100 * t.errors / t.calls) : 0;
  $('errors').textContent = errRate.toFixed(1) + '%';
  $('errors').className = 'value ' + (errRate > 5 ? 'err' : 'ok');
  $('errorCount').textContent = num(t.errors) + ' errors';

  $('month').textContent = usd(s.month.spentUsd);
  if (s.month.budgetUsd) {
    const pct = Math.min(100, 100 * s.month.spentUsd / s.month.budgetUsd);
    $('budgetFill').style.width = pct + '%';
    $('budgetFill').style.background = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--green)';
    $('budgetState').textContent = pct.toFixed(0) + '% of ' + usd(s.month.budgetUsd) + (pct >= 100 ? ' — BLOCKED' : '');
    if (!$('budget').matches(':focus')) $('budget').value = s.month.budgetUsd;
  } else {
    $('budgetState').textContent = 'no budget set';
    $('budgetFill').style.width = '0%';
  }

  const labels = s.daily.map(d => d.day.slice(5));
  dailyChart?.destroy();
  dailyChart = new Chart($('dailyChart'), {
    type: 'bar',
    data: { labels, datasets: [{ data: s.daily.map(d => d.costUsd), backgroundColor: '#58a6ff' }] },
    options: { plugins: { legend: { display: false } }, maintainAspectRatio: false,
      scales: { x: { grid: { display: false }, ticks: { color: '#8b949e' } }, y: { grid: { color: '#21262d' }, ticks: { color: '#8b949e', callback: v => '$' + v } } } }
  });

  modelChart?.destroy();
  modelChart = new Chart($('modelChart'), {
    type: 'doughnut',
    data: { labels: s.byModel.map(m => m.name), datasets: [{ data: s.byModel.map(m => m.costUsd),
      backgroundColor: ['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#39c5cf','#ff7b72','#7ee787'] }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#8b949e', boxWidth: 12 } } } }
  });

  fillTable($('featureTable'), s.byFeature, 'Feature');
  fillTable($('customerTable'), s.byCustomer, 'Customer');

  $('recentTable').innerHTML = '<tr><th>Time</th><th>Model</th><th>Feature</th><th>Customer</th><th class="num">Tokens</th><th class="num">Cost</th><th class="num">ms</th><th>Status</th></tr>' +
    s.recent.map(r => '<tr><td>' + new Date(r.ts).toLocaleString() + '</td><td>' + r.model + '</td><td>' + (r.feature || '–') + '</td><td>' + (r.customerId || '–') + '</td><td class="num">' + num(r.inputTokens + r.outputTokens) + '</td><td class="num">' + usd(r.costUsd) + '</td><td class="num">' + (r.latencyMs ?? '–') + '</td><td class="' + (r.status === 'error' ? 'err' : 'ok') + '">' + (r.status === 'error' ? (r.errorType || 'error') : 'ok') + '</td></tr>').join('');
}

$('days').addEventListener('change', load);
$('saveBudget').addEventListener('click', async () => {
  await fetch('/v1/settings', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ monthlyBudgetUsd: Number($('budget').value) || null }) });
  load();
});
load();
setInterval(load, 30000);
</script>
</body>
</html>`;
