require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const { Market } = require('./src/market');
const { Bot } = require('./src/bot');
const { runAll } = require('./src/backtest');
const { publicList } = require('./src/strategies');
const ind = require('./src/indicators');
const { PaperBroker } = require('./src/brokers/paper');
const { MT5Broker } = require('./src/brokers/mt5');

const os = require('os');
const PORT = Number(process.env.PORT || 3000);
// Na nuvem (Render, Railway...) a variável PORT já vem definida e precisamos aceitar conexões externas.
const HOST = process.env.HOST || (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME ? '0.0.0.0' : '127.0.0.1');
const TICK_SECONDS = Math.max(10, Number(process.env.TICK_SECONDS || 60));
const SIM_TICK_SECONDS = Math.max(2, Number(process.env.SIM_TICK_SECONDS || 5));
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const REAL_ENABLED = process.env.REAL_TRADING_ENABLED === 'true';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !APP_PASSWORD) {
  console.error('\n  ERRO: o site está aberto para outros aparelhos (HOST=' + HOST + '), então defina uma senha em APP_PASSWORD no .env.\n');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const market = new Market();
let backtests = {};
let backtestKey = '';
const getBest = (t) => backtests[t]?.best || 'sma_cross';

const paperBot = new Bot({ mode: 'paper', broker: new PaperBroker(), market, getBest, initialCash: 10000, dataDir: DATA_DIR });
const realBroker = new MT5Broker({ url: process.env.MT5_BRIDGE_URL || 'http://127.0.0.1:5001', token: process.env.MT5_BRIDGE_TOKEN || '' });
const realBot = new Bot({ mode: 'real', broker: realBroker, market, getBest, initialCash: 0, dataDir: DATA_DIR });
if (!REAL_ENABLED && realBot.state.running) { realBot.state.running = false; realBot.save(); }

function refreshBacktests(force = false) {
  const key = market.tickers.map((t) => market.candles(t).at(-1)?.time).join(',');
  if (!force && key === backtestKey) return;
  backtestKey = key;
  backtests = runAll(market, { stopLoss: paperBot.state.config.stopLoss, takeProfit: paperBot.state.config.takeProfit });
}

// ---------------------------------------------------------------- API
const app = express();
app.use(express.json());
app.get('/healthz', (_req, res) => res.json({ ok: true, source: market.source }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/lightweight-charts.js', (_req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')));

// senha simples (obrigatória para o modo real)
function checkPassword(req) {
  if (!APP_PASSWORD) return true;
  const got = Buffer.from(String(req.get('x-app-password') || ''));
  const exp = Buffer.from(APP_PASSWORD);
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}
app.use('/api', (req, res, next) => {
  if (req.path === '/auth-required') return next();
  if (!checkPassword(req)) return res.status(401).json({ error: 'Senha incorreta' });
  next();
});
app.get('/api/auth-required', (_req, res) => res.json({ required: !!APP_PASSWORD }));

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) { res.status(400).json({ error: e.message }); }
};

app.get('/api/market', wrap(() => ({
  source: market.source,
  open: market.isOpen(),
  lastUpdate: market.lastUpdate,
  quotes: market.tickers.map((t) => market.quotes[t]),
})));

app.get('/api/candles/:ticker', wrap((req) => {
  const t = req.params.ticker.toUpperCase();
  if (!market.tickers.includes(t)) throw new Error('Ação desconhecida');
  const intraday = req.query.range === 'intraday';
  const candles = intraday ? market.intradayCandles(t) : market.candles(t);
  const closes = candles.map((c) => c.close);
  const daily = market.candles(t).map((c) => c.close);
  return {
    ticker: t,
    name: market.names[t],
    candles,
    sma9: ind.sma(closes, 9),
    sma21: ind.sma(closes, 21),
    rsi: ind.rsi(daily, 14).at(-1),
  };
}));

app.get('/api/strategies', wrap(() => publicList()));

app.get('/api/analysis', wrap(() => {
  refreshBacktests();
  const { STRATEGIES } = require('./src/strategies');
  const now = {};
  for (const t of market.tickers) {
    const closes = market.candles(t).map((c) => c.close);
    now[t] = Object.fromEntries(STRATEGIES.map((s) => [s.id, s.positions(closes).at(-1)]));
  }
  return { backtests, signals: now, strategies: publicList(), source: market.source };
}));

const botFor = (mode) => {
  if (mode === 'paper') return paperBot;
  if (mode === 'real') return realBot;
  throw new Error('Modo inválido');
};
const assertReal = (bot) => {
  if (bot.mode !== 'real') return;
  if (!REAL_ENABLED) throw new Error('Modo real desativado. Defina REAL_TRADING_ENABLED=true no arquivo .env.');
  if (!APP_PASSWORD) throw new Error('Defina APP_PASSWORD no .env antes de usar o modo real (protege seu dinheiro).');
};
const amountOf = (req) => {
  const a = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!Number.isFinite(a) || a <= 0) throw new Error('Valor inválido');
  return a;
};

app.get('/api/bot/:mode', wrap((req) => botFor(req.params.mode).summary()));

app.post('/api/bot/:mode/start', wrap(async (req) => {
  const bot = botFor(req.params.mode);
  assertReal(bot);
  if (bot.mode === 'real') {
    const h = await realBroker.health();
    if (!h.ok) throw new Error(`Corretora não conectada: ${h.error}`);
    if (bot.state.cash + bot.positionsValue() <= 0) throw new Error('Faça um aporte para o robô antes de iniciar.');
  }
  bot.state.running = true;
  bot.state.halted = false;
  bot.log('Robô INICIADO');
  bot.save();
  bot.tick();
  return bot.summary();
}));

app.post('/api/bot/:mode/stop', wrap((req) => {
  const bot = botFor(req.params.mode);
  bot.state.running = false;
  bot.log('Robô PAUSADO');
  bot.save();
  return bot.summary();
}));

app.post('/api/bot/:mode/config', wrap((req) => {
  const bot = botFor(req.params.mode);
  bot.setConfig(req.body || {});
  if (bot.mode === 'paper') refreshBacktests(true);
  return bot.summary();
}));

app.post('/api/bot/:mode/sell-all', wrap(async (req) => {
  const bot = botFor(req.params.mode);
  assertReal(bot);
  if (bot.mode === 'real' && !market.isOpen()) throw new Error('A B3 está fechada agora.');
  await bot.sellAll();
  return bot.summary();
}));

app.post('/api/bot/paper/reset', wrap(() => { paperBot.reset(); return paperBot.summary(); }));

app.post('/api/bot/:mode/deposit', wrap(async (req) => {
  const bot = botFor(req.params.mode);
  const amount = amountOf(req);
  if (bot.mode === 'real') {
    assertReal(bot);
    const acct = await realBroker.account();
    const free = acct.freeCash - bot.state.cash;
    if (amount > free + 1e-9) {
      throw new Error(`Saldo livre na corretora: R$ ${Math.max(0, free).toFixed(2)}. Faça um Pix/TED para sua conta na corretora primeiro e tente de novo.`);
    }
    bot.deposit(amount, 'Capital liberado para o robô (saldo da corretora)');
  } else {
    bot.deposit(amount, 'Aporte virtual');
  }
  return bot.summary();
}));

app.post('/api/bot/:mode/withdraw', wrap((req) => {
  const bot = botFor(req.params.mode);
  const amount = amountOf(req);
  if (bot.mode === 'real') {
    assertReal(bot);
    bot.withdraw(amount, 'Retirado do robô — fica livre na corretora para resgate via Pix/TED');
  } else {
    bot.withdraw(amount, 'Saque virtual');
  }
  return bot.summary();
}));

app.get('/api/real/status', wrap(async () => {
  const health = await realBroker.health();
  let account = null;
  if (health.ok) { try { account = await realBroker.account(); } catch (e) { health.ok = false; health.error = e.message; } }
  return { enabled: REAL_ENABLED, passwordSet: !!APP_PASSWORD, bridgeUrl: realBroker.url, health, account };
}));

// ---------------------------------------------------------------- loop principal
let lastSource = null;
async function loop() {
  try {
    await market.refresh();
    // se os dados simulados foram trocados pelos reais, os preços mudam totalmente:
    // recomeça a conta de teste para não misturar as duas coisas
    if (lastSource === 'simulado' && market.source === 'yahoo') {
      refreshBacktests(true);
      const wasRunning = paperBot.state.running;
      paperBot.reset();
      paperBot.state.running = wasRunning;
      paperBot.log('Cotações reais disponíveis — conta de teste reiniciada com R$ 10.000 usando os preços de verdade.', 'warn');
      paperBot.save();
    }
    lastSource = market.source;
    refreshBacktests();
    await paperBot.tick();
    if (REAL_ENABLED) await realBot.tick();
  } catch (e) {
    console.error('[loop]', e);
  } finally {
    setTimeout(loop, (market.source === 'simulado' ? SIM_TICK_SECONDS : TICK_SECONDS) * 1000);
  }
}

(async () => {
  await market.init();
  refreshBacktests(true);
  if (!paperBot.state.equity.length) { paperBot.recordEquity(); paperBot.save(); }
  app.listen(PORT, HOST, () => {
    console.log(`\n  Robô B3 rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    if (HOST === '0.0.0.0') {
      const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
      for (const ip of ips) console.log(`  No celular/iPad (mesmo Wi-Fi): http://${ip}:${PORT}`);
    }
    console.log(`  Dados de mercado: ${market.source}`);
    console.log(`  Modo real: ${REAL_ENABLED ? 'ATIVADO' : 'desativado'}\n`);
  });
  loop();
})();
