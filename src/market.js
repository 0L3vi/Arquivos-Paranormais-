// Dados de mercado. Tenta buscar cotações reais no Yahoo Finance (atraso de ~15 min);
// se não conseguir (sem internet, bloqueio etc.), usa dados SIMULADOS e avisa na tela.
const TICKERS = ['PETR4', 'VALE3', 'ITUB4', 'BBAS3', 'BBDC4', 'ABEV3'];

const NAMES = {
  PETR4: 'Petrobras', VALE3: 'Vale', ITUB4: 'Itaú Unibanco',
  BBAS3: 'Banco do Brasil', BBDC4: 'Bradesco', ABEV3: 'Ambev',
};

// preço aproximado usado apenas para gerar dados simulados
const SIM_BASE = { PETR4: 37, VALE3: 60, ITUB4: 36, BBAS3: 24, BBDC4: 15, ABEV3: 13 };

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand) {
  return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}

function spDate(tsSec) {
  // data (AAAA-MM-DD) no fuso de São Paulo
  return new Date(tsSec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function isB3Open(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const m = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  return m >= 10 * 60 + 5 && m <= 16 * 60 + 50; // pregão regular, com folga na abertura/fechamento
}

async function yahooChart(ticker, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?range=${range}&interval=${interval}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const j = await r.json();
  const res = j.chart?.result?.[0];
  if (!res || !res.timestamp) throw new Error('Yahoo sem dados');
  const q = res.indicators.quote[0];
  const candles = res.timestamp
    .map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 }))
    .filter((c) => c.close != null && c.open != null);
  return { candles, meta: res.meta };
}

class Market {
  constructor() {
    this.tickers = TICKERS;
    this.names = NAMES;
    this.source = 'carregando';
    this.daily = {};
    this.intraday = {};
    this.quotes = {};
    this.lastUpdate = null;
    this.simRand = mulberry32(Date.now() % 100000);
  }

  async init() {
    try {
      for (const t of TICKERS) {
        const { candles, meta } = await yahooChart(t, '1y', '1d');
        this.daily[t] = candles;
        this.setQuote(t, meta.regularMarketPrice, meta.chartPreviousClose ?? candles[candles.length - 2]?.close);
      }
      this.source = 'yahoo';
      await this.refresh();
      console.log('[mercado] dados reais do Yahoo Finance carregados');
    } catch (e) {
      console.warn(`[mercado] não foi possível buscar dados reais (${e.message}). Usando dados SIMULADOS.`);
      this.initSimulated();
    }
  }

  initSimulated() {
    this.source = 'simulado';
    const now = Math.floor(Date.now() / 1000);
    for (const t of TICKERS) {
      const rand = mulberry32([...t].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
      let price = SIM_BASE[t] * (0.8 + rand() * 0.3);
      let drift = 0;
      const candles = [];
      let day = now - 365 * 86400;
      while (candles.length < 250) {
        day += 86400;
        const wd = new Date(day * 1000).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        if (candles.length % 40 === 0) drift = (rand() - 0.5) * 0.004; // muda o "regime" de tempos em tempos
        candles.push(this.simCandle(day, price, drift, rand));
        price = candles[candles.length - 1].close;
      }
      this.daily[t] = candles;
      const last = candles[candles.length - 1];
      this.setQuote(t, last.close, candles[candles.length - 2].close);
      this.intraday[t] = [];
    }
    this.lastUpdate = new Date().toISOString();
  }

  simCandle(time, prev, drift, rand) {
    const vol = 0.018;
    const open = prev * (1 + gauss(rand) * 0.004);
    const close = Math.max(0.5, open * (1 + drift + gauss(rand) * vol));
    const high = Math.max(open, close) * (1 + Math.abs(gauss(rand)) * 0.006);
    const low = Math.min(open, close) * (1 - Math.abs(gauss(rand)) * 0.006);
    const r2 = (n) => Math.round(n * 100) / 100;
    return { time, open: r2(open), high: r2(high), low: r2(low), close: r2(close), volume: Math.round(1e6 + rand() * 4e7) };
  }

  setQuote(t, price, prevClose) {
    this.quotes[t] = {
      ticker: t, name: NAMES[t], price,
      prevClose, changePct: prevClose ? (price / prevClose - 1) * 100 : 0,
      time: new Date().toISOString(),
    };
  }

  isOpen() {
    return this.source === 'simulado' ? true : isB3Open();
  }

  // Atualiza as cotações. No modo simulado, cada atualização = 1 pregão novo (acelerado),
  // para você conseguir ver o robô trabalhando rápido.
  async refresh() {
    if (this.source === 'simulado') {
      for (const t of TICKERS) {
        const c = this.daily[t];
        const last = c[c.length - 1];
        const drift = (this.simRand() - 0.5) * 0.004;
        const nc = this.simCandle(last.time + 86400, last.close, drift, this.simRand);
        c.push(nc);
        if (c.length > 400) c.shift();
        this.setQuote(t, nc.close, last.close);
      }
      this.lastUpdate = new Date().toISOString();
      return;
    }
    for (const t of TICKERS) {
      try {
        const { candles, meta } = await yahooChart(t, '1d', '5m');
        this.intraday[t] = candles;
        const price = meta.regularMarketPrice;
        const daily = this.daily[t];
        const last = daily[daily.length - 1];
        const today = spDate(Math.floor(Date.now() / 1000));
        if (candles.length && spDate(candles[0].time) === today) {
          const bar = {
            time: candles[0].time,
            open: candles[0].open,
            high: Math.max(...candles.map((c) => c.high)),
            low: Math.min(...candles.map((c) => c.low)),
            close: price,
            volume: candles.reduce((a, c) => a + c.volume, 0),
          };
          if (spDate(last.time) === today) daily[daily.length - 1] = bar;
          else daily.push(bar);
        }
        this.setQuote(t, price, meta.chartPreviousClose ?? meta.previousClose);
      } catch (e) {
        console.warn(`[mercado] falha ao atualizar ${t}: ${e.message}`);
      }
    }
    this.lastUpdate = new Date().toISOString();
  }

  candles(t) { return this.daily[t] || []; }
  intradayCandles(t) { return this.intraday[t] || []; }
  price(t) { return this.quotes[t]?.price; }
}

module.exports = { Market, TICKERS, NAMES, isB3Open };
