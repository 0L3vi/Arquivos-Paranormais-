// O robô: a cada "tick" olha cada ação, decide comprar / vender / segurar
// e registra tudo (operações, patrimônio, log).
const fs = require('fs');
const path = require('path');
const { byId } = require('./strategies');
const { FEE } = require('./backtest');

const DEFAULT_CONFIG = {
  strategy: 'auto',     // 'auto' = usa a melhor estratégia do backtest para cada ação
  stopLoss: 0.05,       // vende se cair 5% do preço de compra
  takeProfit: 0.10,     // realiza lucro com +10%
  maxPerTicker: 0.20,   // no máximo 20% do patrimônio em uma única ação
  dailyLossLimit: 0.03, // pausa o robô se perder 3% no dia
  tickers: ['PETR4', 'VALE3', 'ITUB4', 'BBAS3', 'BBDC4', 'ABEV3'],
};

const r2 = (n) => Math.round(n * 100) / 100;

class Bot {
  constructor({ mode, broker, market, getBest, initialCash = 0, dataDir }) {
    this.mode = mode;
    this.broker = broker;
    this.market = market;
    this.getBest = getBest;
    this.initialCash = initialCash;
    this.file = path.join(dataDir, `${mode}.json`);
    this.busy = false;
    this.state = this.load();
  }

  fresh() {
    return {
      running: false,
      cash: this.initialCash,
      netDeposits: this.initialCash, // aportes - saques (base para calcular lucro)
      positions: {},
      trades: [],
      equity: [],
      log: [],
      cooldown: {},
      day: null,
      halted: false,
      movements: this.initialCash ? [{ time: new Date().toISOString(), type: 'aporte', amount: this.initialCash, note: 'Saldo inicial' }] : [],
      config: { ...DEFAULT_CONFIG },
      createdAt: new Date().toISOString(),
    };
  }

  load() {
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      s.config = { ...DEFAULT_CONFIG, ...s.config };
      return s;
    } catch {
      return this.fresh();
    }
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.state));
  }

  log(msg, level = 'info') {
    this.state.log.unshift({ time: new Date().toISOString(), msg, level });
    this.state.log.length = Math.min(this.state.log.length, 300);
    console.log(`[${this.mode}] ${msg}`);
  }

  positionsValue() {
    return Object.entries(this.state.positions).reduce((a, [t, p]) => a + p.qty * (this.market.price(t) ?? p.avgPrice), 0);
  }

  equity() { return this.state.cash + this.positionsValue(); }

  strategyFor(t) {
    const id = this.state.config.strategy === 'auto' ? this.getBest(t) : this.state.config.strategy;
    return byId[id] || byId.sma_cross;
  }

  recordEquity() {
    const eq = this.equity();
    const now = Math.floor(Date.now() / 1000);
    const arr = this.state.equity;
    if (arr.length && now - arr[arr.length - 1].time < 5) arr[arr.length - 1] = { time: now, value: r2(eq) };
    else arr.push({ time: now, value: r2(eq) });
    if (arr.length > 3000) arr.splice(0, arr.length - 3000);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.state.running) return;
      if (!this.market.isOpen()) return;

      // limite de perda diária
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const dayKey = this.market.source === 'simulado' ? `sim-${Math.floor(Date.now() / 3600000)}` : today;
      if (!this.state.day || this.state.day.key !== dayKey) {
        this.state.day = { key: dayKey, startEquity: this.equity() };
        this.state.halted = false;
      }
      const cfg = this.state.config;
      if (this.state.halted) return;
      if (this.equity() < this.state.day.startEquity * (1 - cfg.dailyLossLimit)) {
        this.state.halted = true;
        this.log(`Limite de perda diária (${(cfg.dailyLossLimit * 100).toFixed(1)}%) atingido. Robô parado até o próximo dia.`, 'warn');
        return;
      }

      for (const t of cfg.tickers) {
        const price = (await this.broker.price(t)) ?? this.market.price(t);
        if (!price) continue;
        const strat = this.strategyFor(t);
        const desired = strat.positions(this.market.candles(t).map((c) => c.close)).at(-1);
        const pos = this.state.positions[t];

        if (pos) {
          const ch = price / pos.avgPrice - 1;
          if (ch <= -cfg.stopLoss) { await this.sell(t, price, `Stop loss (${(ch * 100).toFixed(1)}%)`, strat); this.state.cooldown[t] = true; }
          else if (ch >= cfg.takeProfit) { await this.sell(t, price, `Lucro realizado (+${(ch * 100).toFixed(1)}%)`, strat); this.state.cooldown[t] = true; }
          else if (desired === 0) await this.sell(t, price, `Sinal de venda — ${strat.name}`, strat);
        } else {
          if (desired === 0) this.state.cooldown[t] = false;
          if (desired === 1 && !this.state.cooldown[t]) await this.buy(t, price, `Sinal de compra — ${strat.name}`, strat);
        }
      }
    } catch (e) {
      this.log(`Erro no ciclo: ${e.message}`, 'error');
    } finally {
      this.recordEquity();
      this.save();
      this.busy = false;
    }
  }

  async buy(t, price, reason, strat) {
    const cfg = this.state.config;
    const budget = Math.min(this.equity() * cfg.maxPerTicker, this.state.cash);
    const qty = Math.floor(budget / (price * (1 + FEE + 0.001)));
    if (qty < 1) return;
    let fill;
    try { fill = await this.broker.marketOrder(t, 'buy', qty, price); }
    catch (e) { this.log(`Ordem de COMPRA ${t} recusada: ${e.message}`, 'error'); return; }
    const value = fill.qty * fill.price;
    const fee = value * FEE;
    this.state.cash = r2(this.state.cash - value - fee);
    this.state.positions[t] = { qty: fill.qty, avgPrice: fill.price, since: new Date().toISOString(), strategy: strat.id };
    this.addTrade({ ticker: t, side: 'buy', qty: fill.qty, price: fill.price, value: r2(value), fee: r2(fee), reason, strategy: strat.id });
    this.log(`COMPRA ${fill.qty} ${t} @ R$ ${fill.price.toFixed(2)} — ${reason}`, 'buy');
  }

  async sell(t, price, reason, strat) {
    const pos = this.state.positions[t];
    if (!pos) return;
    let fill;
    try { fill = await this.broker.marketOrder(t, 'sell', pos.qty, price); }
    catch (e) { this.log(`Ordem de VENDA ${t} recusada: ${e.message}`, 'error'); return; }
    const value = fill.qty * fill.price;
    const fee = value * FEE;
    const pnl = value - fee - pos.qty * pos.avgPrice * (1 + FEE);
    this.state.cash = r2(this.state.cash + value - fee);
    delete this.state.positions[t];
    this.addTrade({ ticker: t, side: 'sell', qty: fill.qty, price: fill.price, value: r2(value), fee: r2(fee), pnl: r2(pnl), reason, strategy: strat?.id });
    this.log(`VENDA ${fill.qty} ${t} @ R$ ${fill.price.toFixed(2)} (${pnl >= 0 ? '+' : ''}R$ ${pnl.toFixed(2)}) — ${reason}`, 'sell');
  }

  addTrade(tr) {
    this.state.trades.unshift({ time: new Date().toISOString(), ...tr });
    this.state.trades.length = Math.min(this.state.trades.length, 1000);
  }

  async sellAll(reason = 'Venda manual de tudo') {
    for (const t of Object.keys(this.state.positions)) {
      const price = (await this.broker.price(t)) ?? this.market.price(t);
      await this.sell(t, price, reason, null);
    }
    this.recordEquity();
    this.save();
  }

  deposit(amount, note) {
    this.state.cash = r2(this.state.cash + amount);
    this.state.netDeposits = r2(this.state.netDeposits + amount);
    this.state.movements.unshift({ time: new Date().toISOString(), type: 'aporte', amount, note });
    this.log(`Aporte de R$ ${amount.toFixed(2)}`, 'info');
    this.recordEquity();
    this.save();
  }

  withdraw(amount, note) {
    if (amount > this.state.cash + 1e-9) throw new Error(`Saldo livre insuficiente (R$ ${this.state.cash.toFixed(2)}). Venda posições antes de sacar.`);
    this.state.cash = r2(this.state.cash - amount);
    this.state.netDeposits = r2(this.state.netDeposits - amount);
    this.state.movements.unshift({ time: new Date().toISOString(), type: 'saque', amount, note });
    this.log(`Saque de R$ ${amount.toFixed(2)}`, 'info');
    this.recordEquity();
    this.save();
  }

  setConfig(c) {
    const cfg = this.state.config;
    const num = (v, min, max) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new Error('Valor de configuração inválido'); return n; };
    if (c.strategy !== undefined) {
      if (c.strategy !== 'auto' && !byId[c.strategy]) throw new Error('Estratégia desconhecida');
      cfg.strategy = c.strategy;
    }
    if (c.stopLoss !== undefined) cfg.stopLoss = num(c.stopLoss, 0.005, 0.5);
    if (c.takeProfit !== undefined) cfg.takeProfit = num(c.takeProfit, 0.005, 2);
    if (c.maxPerTicker !== undefined) cfg.maxPerTicker = num(c.maxPerTicker, 0.05, 1);
    if (c.dailyLossLimit !== undefined) cfg.dailyLossLimit = num(c.dailyLossLimit, 0.005, 0.5);
    if (Array.isArray(c.tickers)) cfg.tickers = c.tickers.filter((t) => DEFAULT_CONFIG.tickers.includes(t));
    this.log('Configuração atualizada');
    this.save();
  }

  reset() {
    this.state = this.fresh();
    this.log(`Conta de teste reiniciada com R$ ${this.initialCash.toFixed(2)}`);
    this.recordEquity();
    this.save();
  }

  summary() {
    const s = this.state;
    const equity = this.equity();
    const sells = s.trades.filter((t) => t.side === 'sell');
    const wins = sells.filter((t) => t.pnl > 0).length;
    const positions = Object.entries(s.positions).map(([t, p]) => {
      const price = this.market.price(t) ?? p.avgPrice;
      return { ticker: t, ...p, price, value: r2(p.qty * price), pnl: r2(p.qty * (price - p.avgPrice)), pnlPct: (price / p.avgPrice - 1) * 100 };
    });
    return {
      mode: this.mode,
      broker: this.broker.name,
      running: s.running,
      halted: s.halted,
      marketOpen: this.market.isOpen(),
      cash: r2(s.cash),
      invested: r2(this.positionsValue()),
      equity: r2(equity),
      netDeposits: s.netDeposits,
      profit: r2(equity - s.netDeposits),
      profitPct: s.netDeposits ? (equity / s.netDeposits - 1) * 100 : 0,
      tradesCount: s.trades.length,
      closedTrades: sells.length,
      winRate: sells.length ? (wins / sells.length) * 100 : 0,
      realizedPnl: r2(sells.reduce((a, t) => a + (t.pnl || 0), 0)),
      positions,
      trades: s.trades.slice(0, 150),
      log: s.log.slice(0, 100),
      equityHistory: s.equity,
      movements: s.movements.slice(0, 50),
      config: s.config,
      strategiesInUse: Object.fromEntries(s.config.tickers.map((t) => [t, this.strategyFor(t).id])),
    };
  }
}

module.exports = { Bot, DEFAULT_CONFIG };
