# 📊 Robô B3

Site + robô que analisa, compra e vende ações da B3:
**PETR4 · VALE3 · ITUB4 · BBAS3 · BBDC4 · ABEV3**

| Aba | O que faz |
|---|---|
| **Mercado** | Cotações, gráfico de candles (diário de 1 ano ou intradiário de 5 min), médias móveis, volume e as compras/vendas do robô marcadas no gráfico. Mostra o que cada estratégia está dizendo agora. |
| **Teste (R$ 10 mil)** | Conta virtual com R$ 10.000. O robô opera sozinho, 24h ligado, com as cotações reais — mas o dinheiro é de mentira. Depósito/saque virtuais, patrimônio, posições, histórico e log. |
| **Estratégias** | Backtest de 5 estratégias em cada ação no último ano (com taxas, stop e alvo). A melhor de cada ação ⭐ é usada no modo *Automático*. |
| **Modo Real** | Mesmo robô, mas enviando ordens de verdade para a sua conta na corretora (via MetaTrader 5). Aporte e saque do capital do robô. |

## Como rodar (modo teste)

Precisa do [Node.js 18+](https://nodejs.org).

```bash
npm install
cp .env.example .env      # no Windows: copy .env.example .env
npm start
```

Abra **http://localhost:3000**, vá na aba **Teste** e clique em **▶ Iniciar**. Deixe o computador ligado e o robô vai operando durante o pregão (10h–17h, seg–sex).

> Cotações vêm do Yahoo Finance (atraso de ~15 min). Se o site não conseguir acessá-las, ele entra em **modo simulado** (aviso amarelo no topo), onde cada ciclo de 5 s equivale a um pregão — útil para ver o robô funcionando rápido.

Os dados ficam salvos em `data/` — se desligar e ligar de novo, o robô continua de onde parou.

## Abrir no celular, iPad e PC 📱💻

O robô é um **programa que roda num computador** (o "servidor"). O celular e o iPad só abrem o site dele, pelo navegador. Eles não conseguem rodar o robô sozinhos. Escolha uma das opções:

### Opção A — PC ligado em casa (grátis)

O PC roda o robô, e o celular/iPad abrem pelo mesmo Wi-Fi.

1. No `.env` do PC:
   ```
   HOST=0.0.0.0
   APP_PASSWORD=uma-senha-forte
   ```
2. `npm start`. Vai aparecer algo como:
   ```
   No celular/iPad (mesmo Wi-Fi): http://192.168.0.15:3000
   ```
3. Digite **esse endereço** no Safari do iPad/celular (não use `localhost`, que só funciona no próprio PC) e entre com a senha.
4. Se não abrir: o Windows pode pedir para liberar o Node no firewall. Clique em **Permitir** (rede privada).

O PC precisa ficar ligado e não pode entrar em suspensão.

### Opção B — Na nuvem (abre de qualquer lugar, até no 4G)

O robô fica num servidor 24h e você abre de qualquer aparelho, em qualquer lugar.

1. Crie uma conta em [render.com](https://render.com) e conecte seu GitHub.
2. **New + → Blueprint** → escolha este repositório (ele lê o `render.yaml`).
3. Digite uma senha em `APP_PASSWORD` quando pedir.
4. Em alguns minutos o Render te dá um link `https://robo-b3-xxxx.onrender.com`. Abra no iPad, celular e PC.

O `render.yaml` usa o plano *Starter* (pago, ~US$ 7/mês) porque no plano grátis o servidor "dorme" quando ninguém está usando, aí o robô para, e os dados se perdem a cada reinício. Também funciona em qualquer serviço que rode Docker (tem um `Dockerfile`).

> **Modo real na nuvem:** o MetaTrader 5 precisa de Windows. Nesse caso use a opção A, ou um VPS Windows rodando o site + MT5 juntos.

### Instalar como app

No Safari do iPhone/iPad: botão **Compartilhar → Adicionar à Tela de Início**. No Android/Chrome: **⋮ → Instalar app**. Fica com ícone e abre em tela cheia, como um aplicativo.

## Como o robô decide

A cada ciclo (60 s), para cada ação:

1. Se **tem** a ação: vende se bater o **stop loss** (padrão −5%), o **take profit** (padrão +10%) ou se a estratégia mandar vender.
2. Se **não tem**: compra se a estratégia mandar comprar, usando no máximo **20% do patrimônio** por ação.
3. Se o patrimônio cair mais que **3% no dia**, o robô para até o dia seguinte.

Estratégias: Cruzamento de Médias 9/21 · RSI 30/70 · Bandas de Bollinger · MACD · Tendência + RSI. Todos os parâmetros podem ser mudados na tela.

## Modo real 💰

O dinheiro **não passa pelo site**. Ele fica na sua conta da corretora, e o robô só envia ordens de compra/venda. Por isso:

- **Depositar** = Pix/TED do seu banco para a corretora → depois, no site, **Aportar** (libera esse valor para o robô usar).
- **Sacar** = no site, **Sacar** (tira do robô; use *Vender tudo* antes se o dinheiro estiver em ações) → depois peça o resgate por Pix/TED no app da corretora.

### Passo a passo

1. Abra conta numa corretora que ofereça **MetaTrader 5** para B3 (ex.: XP, Clear, Rico, Genial, BTG, Modal — confirme com a sua) e peça o acesso ao MT5. **Peça também uma conta DEMO e teste nela primeiro.**
2. Num **computador Windows**, instale o MetaTrader 5, faça login e ative *Ferramentas → Opções → Expert Advisors → Permitir negociação algorítmica*.
3. Instale o [Python 3](https://python.org) e rode a ponte:
   ```bat
   cd bridge
   pip install -r requirements.txt
   set BRIDGE_TOKEN=invente-um-token-grande
   python mt5_bridge.py
   ```
4. No `.env` do site:
   ```
   APP_PASSWORD=uma-senha-forte
   REAL_TRADING_ENABLED=true
   MT5_BRIDGE_TOKEN=invente-um-token-grande
   ```
5. Reinicie o site (`npm start`), vá em **Modo Real**, confira que aparece *Conectado*, faça o **Aporte** e clique em **Iniciar**.

Ordens com quantidade múltipla de 100 vão para o mercado padrão; o resto vai para o fracionário (`PETR4F` etc.).

### Segurança

- O site escuta só em `127.0.0.1` (seu computador). Não exponha na internet sem HTTPS e senha.
- Nunca coloque senha da corretora no código; o login fica no MetaTrader.
- Ações têm risco. Backtest e modo teste **não garantem** lucro no futuro. Comece pequeno.

## Estrutura

```
server.js              API + loop do robô
src/market.js          cotações (Yahoo) / dados simulados
src/indicators.js      SMA, EMA, RSI, Bollinger, MACD
src/strategies.js      estratégias
src/backtest.js        backtest e escolha da melhor estratégia
src/bot.js             o robô (decisão, ordens, carteira, aporte/saque)
src/brokers/paper.js   corretora virtual (modo teste)
src/brokers/mt5.js     corretora real via MetaTrader 5
bridge/mt5_bridge.py   ponte Python ↔ MetaTrader 5
public/                site (HTML/CSS/JS + gráficos Lightweight Charts)
```
