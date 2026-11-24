/* global LightweightCharts */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = (n) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n) => `${n >= 0 ? '+' : ''}${(n ?? 0).toFixed(2).replace('.', ',')}%`;
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const dt = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const BRT = -3 * 3600; // gráficos mostram horário de Brasília

let password = localStorage.getItem('appPassword') || '';
let strategies = [];
let selected = 'PETR4';
let range = 'daily';

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${err ? ' err' : ''}`;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.add('hidden'), 5000);
}

async function api(path, body) {
  const r = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-app-password': password },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) {
    password = await askPassword(!!password);
    localStorage.setItem('appPassword', password);
    return api(path, body);
  }
  if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
  return j;
}

// tela de login (uma só, mesmo com várias chamadas ao mesmo tempo)
let loginPromise = null;
function askPassword(wrong) {
  if (loginPromise) return loginPromise;
  const box = $('#login');
  box.classList.remove('hidden');
  $('#login-err').classList.toggle('hidden', !wrong);
  $('#login-pass').value = '';
  setTimeout(() => $('#login-pass').focus(), 50);
  loginPromise = new Promise((resolve) => {
    $('#login-form').onsubmit = (e) => {
      e.preventDefault();
      box.classList.add('hidden');
      loginPromise = null;
      resolve($('#login-pass').value);
    };
  });
  return loginPromise;
}

// ------------------------------------------------------------------ abas
$$('#tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((x) => x.classList.toggle('active', x.id === `tab-${b.dataset.tab}`));
  location.hash = b.dataset.tab;
  window.dispatchEvent(new Event('resize'));
  refreshAll();
}));
const activeTab = () => $('#tabs button.active').dataset.tab;

// ------------------------------------------------------------------ gráficos
function makeChart(el, height) {
  const chart = LightweightCharts.createChart(el, {
    height: height || el.clientHeight,
    layout: { background: { color: 'transparent' }, textColor: css('--muted') },
    grid: { vertLines: { color: css('--border') }, horzLines: { color: css('--border') } },
    rightPriceScale: { borderColor: css('--border') },
    timeScale: { borderColor: css('--border'), timeVisible: true },
    localization: { locale: 'pt-BR', priceFormatter: (p) => p.toFixed(2) },
  });
  new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth })).observe(el);
  return chart;
}

const priceChart = makeChart($('#price-chart'));
const candleSeries = priceChart.addCandlestickSeries({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down'), borderVisible: false });
const sma9Series = priceChart.addLineSeries({ color: css('--sma9'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
const sma21Series = priceChart.addLineSeries({ color: css('--sma21'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
const volSeries = priceChart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
priceChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
let lastChartKey = '';

async function loadChart() {
  const d = await api(`/candles/${selected}?range=${range}`);
  const shift = (t) => t + BRT;
  const key = `${selected}-${range}`;
  $('#chart-title').textContent = `${d.ticker} — ${d.name}`;
  $('#rsi-now').textContent = d.rsi != null ? `RSI(14): ${d.rsi.toFixed(1)}` : '';
  if (!d.candles.length) { candleSeries.setData([]); sma9Series.setData([]); sma21Series.setData([]); volSeries.setData([]); return; }
  candleSeries.setData(d.candles.map((c) => ({ time: shift(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
  const line = (arr) => d.candles.map((c, i) => (arr[i] == null ? null : { time: shift(c.time), value: arr[i] })).filter(Boolean);
  sma9Series.setData(line(d.sma9));
  sma21Series.setData(line(d.sma21));
  volSeries.setData(d.candles.map((c) => ({ time: shift(c.time), value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)' })));

  // marcações das operações do robô de teste
  const bot = bots.paper.last;
  if (bot) {
    const times = d.candles.map((c) => c.time);
    const markers = bot.trades.filter((t) => t.ticker === selected).map((t) => {
      const ts = Math.floor(new Date(t.time).getTime() / 1000);
      let snap = times[0];
      for (const x of times) if (x <= ts) snap = x;
      if (ts < times[0]) return null;
      return t.side === 'buy'
        ? { time: shift(snap), position: 'belowBar', color: css('--up'), shape: 'arrowUp', text: `C ${t.qty}` }
        : { time: shift(snap), position: 'aboveBar', color: css('--down'), shape: 'arrowDown', text: `V ${t.qty}` };
    }).filter(Boolean).sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);
  }
  if (key !== lastChartKey) { priceChart.timeScale().fitContent(); lastChartKey = key; }
}

$$('#range-seg button').forEach((b) => b.addEventListener('click', () => {
  $$('#range-seg button').forEach((x) => x.classList.toggle('active', x === b));
  range = b.dataset.range;
  loadChart().catch((e) => toast(e.message, true));
}));

// ------------------------------------------------------------------ mercado
async function loadMarket() {
  const m = await api('/market');
  $('#sim-banner').classList.toggle('hidden', m.source !== 'simulado');
  $('#status').innerHTML = `<span><span class="dot ${m.open ? 'on' : 'off'}"></span> B3 ${m.open ? 'aberta' : 'fechada'}</span>
    <span>Fonte: ${m.source === 'yahoo' ? 'Yahoo Finance (~15 min de atraso)' : m.source}</span>
    <span>${m.lastUpdate ? 'Atualizado ' + new Date(m.lastUpdate).toLocaleTimeString('pt-BR') : ''}</span>`;
  $('#quotes').innerHTML = m.quotes.map((q) => `
    <div class="quote ${q.ticker === selected ? 'active' : ''}" data-t="${q.ticker}">
      <div class="row between"><span class="t">${q.ticker}</span><span class="${cls(q.changePct)}">${pct(q.changePct)}</span></div>
      <div class="n">${q.name}</div>
      <div class="p">${brl(q.price)}</div>
    </div>`).join('');
  $$('#quotes .quote').forEach((el) => el.addEventListener('click', () => {
    selected = el.dataset.t;
    $$('#quotes .quote').forEach((x) => x.classList.toggle('active', x === el));
    loadChart().catch((e) => toast(e.message, true));
    loadAnalysis().catch(() => {});
  }));
}

// ------------------------------------------------------------------ estratégias / backtest
const sigLabel = (v) => (v === 1 ? '<span class="badge buy">Comprar</span>' : v === 0 ? '<span class="badge sell">Vender / Fora</span>' : '<span class="badge">Neutro</span>');
const stratName = (id) => strategies.find((s) => s.id === id)?.name || id;

async function loadAnalysis() {
  const a = await api('/analysis');
  strategies = a.strategies;
  const best = a.backtests[selected]?.best;
  $('#signals-now').innerHTML = a.strategies.map((s) => `
    <div class="signal ${s.id === best ? 'best' : ''}"><span>${s.id === best ? '⭐ ' : ''}${s.name}</span>${sigLabel(a.signals[selected][s.id])}</div>`).join('');

  $('#analysis').innerHTML = Object.entries(a.backtests).map(([t, b]) => `
    <div class="card">
      <h3>${t} <span class="muted">— melhor: ${stratName(b.best)} · ${b.period} pregões</span></h3>
      <div class="table-wrap"><table>
        <tr><th>Estratégia</th><th>Retorno</th><th>Comprar e segurar</th><th>Operações</th><th>Acerto</th><th>Queda máx.</th><th>Sinal agora</th></tr>
        ${b.rows.map((r) => `<tr class="${r.strategy === b.best ? 'best' : ''}">
          <td>${r.strategy === b.best ? '⭐ ' : ''}${stratName(r.strategy)}</td>
          <td class="${cls(r.returnPct)}">${pct(r.returnPct)}</td>
          <td class="${cls(r.buyHoldPct)}">${pct(r.buyHoldPct)}</td>
          <td>${r.trades}</td><td>${r.winRate.toFixed(0)}%</td>
          <td class="down">-${r.maxDrawdownPct.toFixed(1)}%</td>
          <td>${sigLabel(a.signals[t][r.strategy])}</td></tr>`).join('')}
      </table></div>
    </div>`).join('');
  $('#strategy-help').innerHTML = `<h3>Como cada estratégia funciona</h3>${a.strategies.map((s) => `<p><b>${s.name}:</b> ${s.description}</p>`).join('')}`;
}

// ------------------------------------------------------------------ painel do robô (teste e real)
const bots = {};

function buildBotPanel(mode) {
  const root = $(`[data-bot="${mode}"]`);
  const isReal = mode === 'real';
  root.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k">Patrimônio do robô</div><div class="v" data-k="equity">—</div></div>
      <div class="kpi"><div class="k">Saldo livre</div><div class="v" data-k="cash">—</div></div>
      <div class="kpi"><div class="k">Em ações</div><div class="v" data-k="invested">—</div></div>
      <div class="kpi"><div class="k">Resultado</div><div class="v" data-k="profit">—</div></div>
      <div class="kpi"><div class="k">Operações / acerto</div><div class="v" data-k="trades">—</div></div>
    </div>
    <div class="card">
      <div class="row between">
        <div class="row"><h3 style="margin:0">Robô</h3><span data-k="state" class="badge">—</span></div>
        <div class="row">
          <button class="btn green" data-a="start">▶ Iniciar</button>
          <button class="btn" data-a="stop">⏸ Pausar</button>
          <button class="btn" data-a="sell-all">Vender tudo</button>
          ${isReal ? '' : '<button class="btn red" data-a="reset">Reiniciar R$ 10 mil</button>'}
        </div>
      </div>
      <hr style="border:0;border-top:1px solid var(--border);margin:14px 0">
      <div class="form">
        <label class="f">Estratégia<select data-c="strategy"><option value="auto">⭐ Automático (melhor de cada ação)</option></select></label>
        <label class="f">Stop loss (%)<input type="number" step="0.5" min="0.5" data-c="stopLoss"></label>
        <label class="f">Take profit (%)<input type="number" step="0.5" min="0.5" data-c="takeProfit"></label>
        <label class="f">Máx. por ação (%)<input type="number" step="5" min="5" max="100" data-c="maxPerTicker"></label>
        <label class="f">Perda máx. no dia (%)<input type="number" step="0.5" min="0.5" data-c="dailyLossLimit"></label>
        <button class="btn primary" data-a="config">Salvar configuração</button>
      </div>
      <div class="form" style="margin-top:12px" data-c="tickers"></div>
    </div>
    <div class="card">
      <h3>${isReal ? 'Aporte e saque do robô' : 'Depósito e saque (virtual)'}</h3>
      <p class="muted" style="margin-top:0">${isReal
        ? 'Aporte = libera parte do saldo da sua corretora para o robô usar. Saque = tira dinheiro do robô (precisa estar em saldo livre; use "Vender tudo" antes se precisar). Para mandar o dinheiro para o seu banco, peça o resgate por Pix/TED no app da corretora.'
        : 'Simule colocar ou tirar dinheiro da conta de teste.'}</p>
      <div class="form">
        <label class="f">Valor (R$)<input type="number" step="50" min="1" data-m="amount" placeholder="1000"></label>
        <button class="btn green" data-a="deposit">+ ${isReal ? 'Aportar' : 'Depositar'}</button>
        <button class="btn red" data-a="withdraw">− Sacar</button>
      </div>
      <div class="table-wrap" style="max-height:160px;margin-top:10px"><table data-t="movements"></table></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Evolução do patrimônio</h3><div class="chart small" data-chart></div></div>
      <div class="card"><h3>Posições abertas</h3><div class="table-wrap"><table data-t="positions"></table></div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Histórico de operações</h3><div class="table-wrap"><table data-t="trades"></table></div></div>
      <div class="card"><h3>Log do robô</h3><div class="log" data-t="log"></div></div>
    </div>`;

  const chartEl = $('[data-chart]', root);
  const chart = makeChart(chartEl, 260);
  const series = chart.addAreaSeries({ lineColor: css('--accent'), topColor: 'rgba(59,130,246,.35)', bottomColor: 'rgba(59,130,246,0)', lineWidth: 2 });
  bots[mode] = { root, chart, series, configLoaded: false, last: null };

  const act = async (a) => {
    const cfgVal = (k) => $(`[data-c="${k}"]`, root).value;
    try {
      if (a === 'start' && isReal && !confirm('Iniciar o robô com DINHEIRO REAL? Ele vai enviar ordens para a sua corretora.')) return;
      if (a === 'sell-all' && !confirm('Vender todas as posições do robô agora?')) return;
      if (a === 'reset' && !confirm('Apagar todo o histórico do teste e voltar para R$ 10.000?')) return;
      let body = {};
      if (a === 'config') {
        body = {
          strategy: cfgVal('strategy'),
          stopLoss: cfgVal('stopLoss') / 100,
          takeProfit: cfgVal('takeProfit') / 100,
          maxPerTicker: cfgVal('maxPerTicker') / 100,
          dailyLossLimit: cfgVal('dailyLossLimit') / 100,
          tickers: $$('[data-c="tickers"] input:checked', root).map((i) => i.value),
        };
      }
      if (a === 'deposit' || a === 'withdraw') {
        body = { amount: Number($('[data-m="amount"]', root).value) };
        if (isReal && a === 'deposit' && !confirm(`Liberar ${brl(body.amount)} do saldo da corretora para o robô?`)) return;
      }
      const s = await api(`/bot/${mode}/${a}`, body);
      if (a === 'config' || a === 'reset') bots[mode].configLoaded = false;
      renderBot(mode, s);
      toast({ start: 'Robô iniciado', stop: 'Robô pausado', config: 'Configuração salva', deposit: 'Valor adicionado', withdraw: 'Saque feito', 'sell-all': 'Posições vendidas', reset: 'Conta de teste reiniciada' }[a]);
      if (a === 'deposit' || a === 'withdraw') $('[data-m="amount"]', root).value = '';
    } catch (e) { toast(e.message, true); }
  };
  $$('[data-a]', root).forEach((b) => b.addEventListener('click', () => act(b.dataset.a)));
}

function renderBot(mode, s) {
  const b = bots[mode];
  const { root } = b;
  b.last = s;
  const set = (k, html) => { $(`[data-k="${k}"]`, root).innerHTML = html; };
  set('equity', brl(s.equity));
  set('cash', brl(s.cash));
  set('invested', brl(s.invested));
  set('profit', `<span class="${cls(s.profit)}">${brl(s.profit)} <small>${pct(s.profitPct)}</small></span>`);
  set('trades', `${s.tradesCount} <small class="muted">/ ${s.closedTrades ? s.winRate.toFixed(0) + '%' : '—'}</small>`);
  const st = $('[data-k="state"]', root);
  st.className = `badge ${s.running ? 'run' : ''}`;
  st.textContent = s.halted ? 'Parado (limite diário)' : s.running ? (s.marketOpen ? 'Rodando' : 'Rodando — aguardando pregão') : 'Pausado';
  $('[data-a="start"]', root).disabled = s.running;
  $('[data-a="stop"]', root).disabled = !s.running;

  if (!b.configLoaded && strategies.length) {
    const sel = $('[data-c="strategy"]', root);
    sel.innerHTML = '<option value="auto">⭐ Automático (melhor de cada ação)</option>' + strategies.map((x) => `<option value="${x.id}">${x.name}</option>`).join('');
    sel.value = s.config.strategy;
    for (const k of ['stopLoss', 'takeProfit', 'maxPerTicker', 'dailyLossLimit']) $(`[data-c="${k}"]`, root).value = +(s.config[k] * 100).toFixed(2);
    $('[data-c="tickers"]', root).innerHTML = '<span class="muted">Ações:</span>' + ['PETR4', 'VALE3', 'ITUB4', 'BBAS3', 'BBDC4', 'ABEV3']
      .map((t) => `<label><input type="checkbox" value="${t}" ${s.config.tickers.includes(t) ? 'checked' : ''}> ${t}</label>`).join(' ');
    b.configLoaded = true;
  }

  $('[data-t="positions"]', root).innerHTML = s.positions.length
    ? `<tr><th>Ação</th><th>Qtd</th><th>Preço médio</th><th>Atual</th><th>Resultado</th><th>Estratégia</th></tr>` +
      s.positions.map((p) => `<tr><td><b>${p.ticker}</b></td><td>${p.qty}</td><td>${brl(p.avgPrice)}</td><td>${brl(p.price)}</td>
        <td class="${cls(p.pnl)}">${brl(p.pnl)} (${pct(p.pnlPct)})</td><td class="muted">${stratName(p.strategy)}</td></tr>`).join('')
    : '<tr><td class="muted">Nenhuma posição aberta.</td></tr>';

  $('[data-t="trades"]', root).innerHTML = s.trades.length
    ? `<tr><th>Data</th><th>Tipo</th><th>Ação</th><th>Qtd</th><th>Preço</th><th>Total</th><th>Resultado</th><th>Motivo</th></tr>` +
      s.trades.map((t) => `<tr><td>${dt(t.time)}</td><td><span class="badge ${t.side}">${t.side === 'buy' ? 'Compra' : 'Venda'}</span></td>
        <td>${t.ticker}</td><td>${t.qty}</td><td>${brl(t.price)}</td><td>${brl(t.value)}</td>
        <td class="${cls(t.pnl)}">${t.pnl != null ? brl(t.pnl) : ''}</td><td class="muted">${t.reason}</td></tr>`).join('')
    : '<tr><td class="muted">Nenhuma operação ainda. Clique em Iniciar.</td></tr>';

  $('[data-t="movements"]', root).innerHTML = s.movements.length
    ? s.movements.map((m) => `<tr><td>${dt(m.time)}</td><td><span class="badge ${m.type === 'aporte' ? 'buy' : 'sell'}">${m.type}</span></td><td>${brl(m.amount)}</td><td class="muted">${m.note || ''}</td></tr>`).join('')
    : '<tr><td class="muted">Nenhuma movimentação.</td></tr>';

  $('[data-t="log"]', root).innerHTML = s.log.map((l) => `<div class="${l.level}">${dt(l.time)} — ${l.msg}</div>`).join('') || '<span class="muted">Sem eventos.</span>';

  const eq = s.equityHistory.map((p) => ({ time: p.time + BRT, value: p.value }));
  const dedup = eq.filter((p, i) => i === eq.length - 1 || eq[i + 1].time > p.time);
  b.series.setData(dedup);
}

async function loadBot(mode) {
  renderBot(mode, await api(`/bot/${mode}`));
}

async function loadRealStatus() {
  const s = await api('/real/status');
  const a = s.account;
  const ok = s.enabled && s.passwordSet && s.health.ok;
  $('#real-status').innerHTML = `
    <div class="row between"><h3 style="margin:0">Conexão com a corretora</h3>
      <span class="badge ${ok ? 'run' : ''}">${ok ? 'Conectado' : 'Não conectado'}</span></div>
    ${a ? `<div class="kpis" style="margin:12px 0 0">
        <div class="kpi"><div class="k">Corretora</div><div class="v" style="font-size:15px">${a.company}${a.demo ? ' <span class="badge">DEMO</span>' : ''}</div></div>
        <div class="kpi"><div class="k">Conta</div><div class="v" style="font-size:15px">${a.login}</div></div>
        <div class="kpi"><div class="k">Saldo na corretora</div><div class="v">${brl(a.balance)}</div></div>
        <div class="kpi"><div class="k">Disponível</div><div class="v">${brl(a.freeCash)}</div></div>
      </div>` : ''}
    ${ok ? '' : `<ol class="steps" style="margin-top:12px">
        <li>${s.enabled ? '✅' : '❌'} Ativar o modo real: <code>REAL_TRADING_ENABLED=true</code> no arquivo <code>.env</code></li>
        <li>${s.passwordSet ? '✅' : '❌'} Definir uma senha para o site: <code>APP_PASSWORD=...</code> no <code>.env</code></li>
        <li>${s.health.ok ? '✅' : '❌'} Abrir o MetaTrader 5 logado na sua corretora e rodar a ponte <code>bridge/mt5_bridge.py</code> (${s.bridgeUrl})${s.health.error ? ` — <span class="down">${s.health.error}</span>` : ''}</li>
        <li>Fazer um Pix para a sua conta na corretora, e então usar o botão <b>Aportar</b> abaixo.</li>
        <li class="muted">Veja o passo a passo completo no README.md.</li>
      </ol>`}`;
}

// ------------------------------------------------------------------ atualização periódica
async function refreshAll() {
  const tab = activeTab();
  const jobs = [loadMarket()];
  if (tab === 'market') jobs.push(loadChart(), bots.paper.last ? null : loadBot('paper'));
  if (tab === 'paper') jobs.push(loadBot('paper'));
  if (tab === 'real') jobs.push(loadBot('real'), loadRealStatus());
  if (tab === 'analysis' || tab === 'market') jobs.push(loadAnalysis());
  const res = await Promise.allSettled(jobs);
  const fail = res.find((r) => r.status === 'rejected');
  if (fail) console.warn(fail.reason);
}

(async () => {
  buildBotPanel('paper');
  buildBotPanel('real');
  try { strategies = await api('/strategies'); } catch (e) { toast(e.message, true); }
  await loadBot('paper').catch(() => {});
  if (location.hash) $(`#tabs button[data-tab="${location.hash.slice(1)}"]`)?.click();
  await refreshAll();
  setInterval(refreshAll, 5000);
})();
