"""
Ponte entre o site (Node) e o MetaTrader 5 da sua corretora.

Requisitos:
  - Windows com o MetaTrader 5 instalado e LOGADO na sua conta (comece por uma conta DEMO!)
  - Python 3.9+  ->  pip install -r requirements.txt
  - Em Ferramentas > Opções > Expert Advisors, marque "Permitir negociação algorítmica"

Rodar:
  set BRIDGE_TOKEN=um-token-secreto-qualquer
  python mt5_bridge.py

O mesmo token vai em MT5_BRIDGE_TOKEN no arquivo .env do site.
"""
import os
import hmac
import MetaTrader5 as mt5
from flask import Flask, jsonify, request

TOKEN = os.environ.get("BRIDGE_TOKEN", "")
PORT = int(os.environ.get("BRIDGE_PORT", "5001"))
LOT = 100           # lote padrão da B3
MAGIC = 330033      # identifica as ordens do robô
ALLOWED = {"PETR4", "VALE3", "ITUB4", "BBAS3", "BBDC4", "ABEV3"}

app = Flask(__name__)


def ensure():
    if mt5.terminal_info() is None and not mt5.initialize():
        raise RuntimeError(f"MetaTrader 5 não inicializou: {mt5.last_error()}")


@app.before_request
def auth():
    if not TOKEN:
        return jsonify(error="Defina BRIDGE_TOKEN antes de rodar a ponte"), 500
    if not hmac.compare_digest(request.headers.get("X-Bridge-Token", ""), TOKEN):
        return jsonify(error="token inválido"), 401


@app.errorhandler(Exception)
def on_error(e):
    return jsonify(error=str(e)), 400


@app.get("/health")
def health():
    ensure()
    t = mt5.terminal_info()
    return jsonify(connected=bool(t.connected), trade_allowed=bool(t.trade_allowed))


@app.get("/account")
def account():
    ensure()
    a = mt5.account_info()
    if a is None:
        raise RuntimeError("Não logado em nenhuma conta no MetaTrader 5")
    return jsonify(
        login=a.login, server=a.server, company=a.company, currency=a.currency,
        balance=a.balance, equity=a.equity, freeCash=a.margin_free,
        demo=a.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO,
    )


@app.get("/price/<symbol>")
def price(symbol):
    ensure()
    symbol = symbol.upper()
    if symbol not in ALLOWED:
        raise ValueError("ativo não permitido")
    mt5.symbol_select(symbol, True)
    tick = mt5.symbol_info_tick(symbol)
    return jsonify(price=(tick.last or tick.bid) if tick else None)


def send(symbol, side, volume):
    mt5.symbol_select(symbol, True)
    info = mt5.symbol_info(symbol)
    if info is None:
        raise RuntimeError(f"Ativo {symbol} não encontrado na corretora")
    tick = mt5.symbol_info_tick(symbol)
    is_buy = side == "buy"
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": float(volume),
        "type": mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
        "price": tick.ask if is_buy else tick.bid,
        "deviation": 20,
        "magic": MAGIC,
        "comment": "robo-b3",
        "type_time": mt5.ORDER_TIME_DAY,
        "type_filling": mt5.ORDER_FILLING_RETURN,
    }
    res = mt5.order_send(req)
    if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
        raise RuntimeError(f"Ordem recusada em {symbol}: {getattr(res, 'comment', mt5.last_error())}")
    return res.price or req["price"], res.volume


@app.post("/order")
def order():
    ensure()
    body = request.get_json(force=True)
    symbol = str(body["symbol"]).upper()
    side = body["side"]
    qty = int(body["qty"])
    if symbol not in ALLOWED or side not in ("buy", "sell") or qty <= 0:
        raise ValueError("ordem inválida")

    # B3: múltiplos de 100 no mercado padrão, o resto no fracionário (PETR4F etc.)
    fills = []
    lots = (qty // LOT) * LOT
    frac = qty - lots
    if lots:
        fills.append(send(symbol, side, lots))
    if frac:
        fills.append(send(symbol + "F", side, frac))
    total = sum(v for _, v in fills)
    avg = sum(p * v for p, v in fills) / total
    return jsonify(price=round(avg, 2), qty=int(total))


if __name__ == "__main__":
    ensure()
    print(f"Ponte MT5 rodando em http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT)
