// Corretora de mentira (modo teste). Executa as ordens no preço atual
// com um pequeno "slippage" para ficar mais realista.
class PaperBroker {
  constructor() { this.name = 'Simulador (dinheiro virtual)'; this.real = false; }
  async health() { return { ok: true }; }
  async price() { return null; } // usa a cotação do módulo de mercado
  async marketOrder(ticker, side, qty, refPrice) {
    const slip = 0.0005;
    const price = side === 'buy' ? refPrice * (1 + slip) : refPrice * (1 - slip);
    return { price: Math.round(price * 100) / 100, qty };
  }
}
module.exports = { PaperBroker };
