// Backtest: roda cada estratégia sobre o histórico de cada ação e mede o resultado.
// Usa as mesmas regras do robô (taxas, stop loss, take profit e "cooldown").
const { STRATEGIES } = require('./strategies');

const FEE = 0.0003; // emolumentos + liquidação B3 (~0,03%)

function backtest(candles, strategy, { stopLoss = 0.05, takeProfit = 0.1, capital = 10000 } = {}) {
  const closes = candles.map((c) => c.close);
  const pos = strategy.positions(closes);
  let cash = capital, qty = 0, avg = 0, cooldown = false;
  let peak = capital, maxDD = 0, wins = 0, trades = 0;
  const equity = [];

  for (let i = 0; i < candles.length; i++) {
    const p = closes[i];
    const want = pos[i];
    if (qty > 0) {
      const ch = p / avg - 1;
      let exit = false;
      if (ch <= -stopLoss || ch >= takeProfit) { exit = true; cooldown = true; }
      else if (want === 0) exit = true;
      if (exit) {
        const value = qty * p;
        cash += value - value * FEE;
        if (p > avg) wins++;
        trades++;
        qty = 0;
      }
    } else {
      if (want === 0) cooldown = false;
      if (want === 1 && !cooldown) {
        const q = Math.floor(cash / (p * (1 + FEE)));
        if (q > 0) { cash -= q * p * (1 + FEE); qty = q; avg = p; }
      }
    }
    const eq = cash + qty * p;
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, (peak - eq) / peak);
    equity.push(eq);
  }
  const final = equity[equity.length - 1] ?? capital;
  return {
    strategy: strategy.id,
    returnPct: (final / capital - 1) * 100,
    buyHoldPct: closes.length ? (closes[closes.length - 1] / closes[0] - 1) * 100 : 0,
    trades,
    winRate: trades ? (wins / trades) * 100 : 0,
    maxDrawdownPct: maxDD * 100,
    stillOpen: qty > 0,
  };
}

// Nota usada para escolher a "melhor forma de negociar" cada ação:
// retorno penalizado pela queda máxima (drawdown) para evitar estratégias muito arriscadas.
function score(r) {
  return r.returnPct - 0.5 * r.maxDrawdownPct;
}

function runAll(market, opts) {
  const result = {};
  for (const t of market.tickers) {
    const candles = market.candles(t);
    const rows = STRATEGIES.map((s) => backtest(candles, s, opts));
    const best = rows.reduce((a, b) => (score(b) > score(a) ? b : a));
    result[t] = { rows, best: best.strategy, period: candles.length };
  }
  return result;
}

module.exports = { backtest, runAll, FEE };
