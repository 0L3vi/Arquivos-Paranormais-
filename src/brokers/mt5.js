// Corretora real via MetaTrader 5.
// O Node conversa com uma pontezinha em Python (bridge/mt5_bridge.py) que roda
// no mesmo computador do MetaTrader 5 logado na sua corretora (XP, Clear, Rico, BTG, Genial, Modal...).
class MT5Broker {
  constructor({ url, token }) {
    this.name = 'MetaTrader 5';
    this.real = true;
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  async req(path, body) {
    const r = await fetch(this.url + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': this.token || '' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `ponte MT5 respondeu HTTP ${r.status}`);
    return j;
  }

  async health() {
    try { return { ok: true, ...(await this.req('/health')) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  // { login, server, company, balance, equity, freeCash, currency }
  account() { return this.req('/account'); }

  async price(ticker) {
    try { const j = await this.req(`/price/${ticker}`); return j.price || null; }
    catch { return null; }
  }

  // devolve { price, qty } efetivamente executados
  marketOrder(ticker, side, qty) {
    return this.req('/order', { symbol: ticker, side, qty });
  }
}
module.exports = { MT5Broker };
