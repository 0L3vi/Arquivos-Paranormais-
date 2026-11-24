// Indicadores técnicos clássicos. Todos recebem um array de números e
// devolvem um array do mesmo tamanho (null onde ainda não há dados).

function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i === n - 1) {
      prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
      out[i] = prev;
    } else if (i >= n) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

// RSI de Wilder
function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= n) {
      gain += g; loss += l;
      if (i === n) { gain /= n; loss /= n; out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); }
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

function bollinger(values, n = 20, k = 2) {
  const mid = sma(values, n);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const slice = values.slice(i - n + 1, i + 1);
    const m = mid[i];
    const sd = Math.sqrt(slice.reduce((a, v) => a + (v - m) ** 2, 0) / n);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}

function macd(values, fast = 12, slow = 26, signalN = 9) {
  const ef = ema(values, fast), es = ema(values, slow);
  const line = values.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const start = line.findIndex((v) => v != null);
  const signal = new Array(values.length).fill(null);
  if (start >= 0) {
    const sig = ema(line.slice(start), signalN);
    sig.forEach((v, j) => (signal[start + j] = v));
  }
  return { line, signal };
}

module.exports = { sma, ema, rsi, bollinger, macd };
