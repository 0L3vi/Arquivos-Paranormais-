// Estratégias de negociação.
// Cada estratégia devolve, para cada candle, a "posição desejada":
//   1    -> quer estar comprado
//   0    -> quer estar fora (vender)
//   null -> sem opinião (mantém o que já tem)
const ind = require('./indicators');

const STRATEGIES = [
  {
    id: 'sma_cross',
    name: 'Cruzamento de Médias (9/21)',
    description: 'Compra quando a média curta (9) está acima da longa (21) — segue a tendência. Vende quando cruza para baixo.',
    positions(closes) {
      const f = ind.sma(closes, 9), s = ind.sma(closes, 21);
      return closes.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] > s[i] ? 1 : 0));
    },
  },
  {
    id: 'rsi',
    name: 'IFR / RSI (30/70)',
    description: 'Compra quando o RSI(14) cai abaixo de 30 (sobrevendido) e vende acima de 70 (sobrecomprado).',
    positions(closes) {
      const r = ind.rsi(closes, 14);
      return r.map((v) => (v == null ? null : v < 30 ? 1 : v > 70 ? 0 : null));
    },
  },
  {
    id: 'bollinger',
    name: 'Bandas de Bollinger',
    description: 'Compra quando o preço fura a banda inferior e vende quando volta à média ou toca a banda superior.',
    positions(closes) {
      const b = ind.bollinger(closes, 20, 2);
      return closes.map((c, i) => (b.mid[i] == null ? null : c < b.lower[i] ? 1 : c > b.mid[i] ? 0 : null));
    },
  },
  {
    id: 'macd',
    name: 'MACD (12/26/9)',
    description: 'Compra com a linha MACD acima da linha de sinal (momento positivo) e vende quando fica abaixo.',
    positions(closes) {
      const m = ind.macd(closes);
      return closes.map((_, i) => (m.signal[i] == null ? null : m.line[i] > m.signal[i] ? 1 : 0));
    },
  },
  {
    id: 'trend_rsi',
    name: 'Tendência + RSI',
    description: 'Só compra em tendência de alta (preço acima da média de 50) quando há um recuo (RSI < 45). Sai se o RSI passar de 70 ou o preço perder a média.',
    positions(closes) {
      const s = ind.sma(closes, 50), r = ind.rsi(closes, 14);
      return closes.map((c, i) => {
        if (s[i] == null || r[i] == null) return null;
        if (c < s[i] || r[i] > 70) return 0;
        if (r[i] < 45) return 1;
        return null;
      });
    },
  },
];

const byId = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]));

function publicList() {
  return STRATEGIES.map(({ id, name, description }) => ({ id, name, description }));
}

module.exports = { STRATEGIES, byId, publicList };
