// === main.js (synced with enhanced deriv.js) ===
// PurpleBot by Sanne Karibo
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const dotenv = require('dotenv');
const deriv = require('./deriv');
const indicators = require('./indicators');
const http = require('http');
const { Server } = require('ws');
const cors = require('cors');

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

const PORT = process.env.PORT || 3000;
const TRADE_INTERVAL_MS = 10 * 1000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let tradingInterval = null;
let lastProposal = null;
let lastCandleEpoch = 0;

wss.on('connection', (socket) => {
  console.log('[🌐] WebSocket client connected');

  const sendLiveData = async () => {
    const candles = deriv.getCandles();
    const indicatorResults = {
      ema20: await indicators.calculateEMA(candles, 20),
      rsi7: await indicators.calculateRSI(candles, 7),
      fractals: await indicators.calculateBillWilliamsFractals(candles)
    };

    const data = {
      type: 'update',
      candles,
      indicators: indicatorResults,
      trades: {
        active: Array.from(deriv.openContracts.values()),
        closed: Array.from(deriv.closedContracts.values())
      },
      balance: deriv.getAccountBalance()
    };

    try {
      socket.send(JSON.stringify(data));
    } catch (err) {
      console.error('[❌] WebSocket send failed:', err.message);
    }
  };

  const interval = setInterval(sendLiveData, 3000);
  socket.on('close', () => clearInterval(interval));
});

app.post('/trade-start', (req, res) => {
  if (tradingInterval) return res.status(409).json({ error: 'Already running' });
  console.log('[🚀] Starting bot...');
  tradingInterval = setInterval(tradingLoop, TRADE_INTERVAL_MS);
  res.json({ message: 'Bot started' });
});

app.post('/trade-end', (req, res) => {
  if (!tradingInterval) return res.status(409).json({ error: 'Bot not active' });
  clearInterval(tradingInterval);
  tradingInterval = null;
  lastProposal = null;
  console.log('[🛑] Bot stopped.');
  res.json({ message: 'Bot stopped' });
});

app.post('/set-symbol', async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });
  const available = deriv.getAvailableSymbols();
  if (!available.includes(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol', availableSymbols: available });
  }
  await updateEnvVariable('SYMBOL', symbol);
  deriv.reconnectWithNewSymbol(symbol);
  res.json({ message: 'Symbol updated' });
});

app.post('/set-api-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing API token' });

  try {
    await updateEnvVariable('DERIV_API_TOKEN', token);
    deriv.reconnectWithNewToken(token);
    console.log('[🔐] API Token updated');
    res.json({ message: 'API token set successfully' });
  } catch (err) {
    console.error('[❌] Failed to set API token:', err.message);
    res.status(500).json({ error: 'Failed to update token' });
  }
});

app.get('/symbol-info', (req, res) => {
  res.json({
    currentSymbol: deriv.getCurrentSymbol(),
    availableSymbols: deriv.getAvailableSymbols(),
    symbolDetails: deriv.getSymbolDetails()
  });
});

app.get('/api/account-info', (req, res) => {
  const info = deriv.getAccountInfo?.();
  if (!info || !info.loginid) return res.status(404).json({ error: 'Account not authorized' });
  res.json(info);
});

app.get('/api/token-status', (req, res) => {
  const info = deriv.getAccountInfo?.();
  const connected = !!(info && info.loginid);
  res.json({ connected });
});

app.get('/api/balance', (req, res) => {
  try {
    deriv.requestBalance?.();
    const balance = deriv.getAccountBalance();
    if (balance === null) return res.status(202).json({ message: 'Fetching balance...' });
    res.json({ balance });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve balance' });
  }
});

app.get('/api/chart-data', async (req, res) => {
  const candles = deriv.getCandles();
  if (!candles || candles.length === 0) {
    return res.status(202).json({ message: 'Candle data not yet available' });
  }

  console.log(`[📊] Chart data request — ${candles.length} candles`);

  const ema20 = await indicators.calculateEMA(candles, 20);
  const rsi7 = await indicators.calculateRSI(candles, 7);
  const fractals = await indicators.calculateBillWilliamsFractals(candles);

  res.json({
    candles,
    indicators: {
      ema20,
      rsi7,
      fractalHighs: fractals.upper,
      fractalLows: fractals.lower
    },
    activeTrades: Array.from(deriv.openContracts.values()),
    closedTrades: Array.from(deriv.closedContracts.values())
  });
});

async function updateEnvVariable(key, value) {
  const envPath = path.join(__dirname, '.env');
  try {
    let content = '';
    try { content = await fs.readFile(envPath, 'utf8'); } catch {}
    const lines = content.split('\n');
    const updated = lines.map(line => line.startsWith(`${key}=`) ? `${key}=${value}` : line);
    if (!lines.some(line => line.startsWith(`${key}=`))) updated.push(`${key}=${value}`);
    await fs.writeFile(envPath, updated.join('\n'));
    process.env[key] = value;
  } catch (err) {
    console.error(`[❌] Failed to update ${key}:`, err.message);
    throw err;
  }
}

function getTradingSignals() {
  const candles = deriv.getCandles();
  if (!candles || candles.length < 20) return null;

  try {
    const rsi = indicators.calculateRSI(candles, 7);
    const ema20 = indicators.calculateEMA(candles, 20);
    const fractals = indicators.calculateBillWilliamsFractals(candles);

    const latest = candles.at(-1);
    const prev1 = candles.at(-2);
    const prev2 = candles.at(-3);

    if (!latest || !prev1 || !prev2) return null;

    const highestHigh = Math.max(prev1.high, prev2.high);
    const lowestLow = Math.min(prev1.low, prev2.low);

    let lastUpperFractal = null;
    let lastLowerFractal = null;
    for (let i = fractals.upper.length - 3; i >= 0; i--) {
      if (fractals.upper[i] !== null) {
        lastUpperFractal = fractals.upper[i];
        break;
      }
    }
    for (let i = fractals.lower.length - 3; i >= 0; i--) {
      if (fractals.lower[i] !== null) {
        lastLowerFractal = fractals.lower[i];
        break;
      }
    }

    const buySignal =
      rsi.at(-2) > 55 &&
      prev1.close > ema20.at(-2) &&
      latest.close > highestHigh &&
      latest.close < lastUpperFractal;

    const sellSignal =
      rsi.at(-2) < 45 &&
      prev1.close < ema20.at(-2) &&
      latest.close < lowestLow &&
      latest.close > lastLowerFractal;

    return {
      buySignal,
      sellSignal,
      highestHigh,
      lowestLow,
      lastUpperFractal,
      lastLowerFractal
    };
  } catch (err) {
    console.error('[❌] Signal Error:', err);
    return null;
  }
}

function tradingLoop() {
  const candles = deriv.getCandles();
  if (!candles || candles.length < 20) return;

  const latest = candles.at(-1);
  if (!latest || typeof latest.close === 'undefined') return;

  const currentEpoch = latest.epoch;
  if (currentEpoch === lastCandleEpoch) return;
  lastCandleEpoch = currentEpoch;

  const signals = getTradingSignals();
  if (!signals) return;

  const openBuyContracts = Array.from(deriv.openContracts.values()).filter(c => c.contract_type === 'CALL');
  const openSellContracts = Array.from(deriv.openContracts.values()).filter(c => c.contract_type === 'PUT');

  if (signals.buySignal && openBuyContracts.length < 5) {
    if (lastProposal?.contract_type === 'CALL') {
      console.log('[🟢] Executing BUY contract at breakout');
      deriv.buyContract(lastProposal.id, lastProposal.ask_price);
      lastProposal = null;
    } else {
      console.log('[📨] Requesting new BUY proposal');
      deriv.requestTradeProposal('CALL', 10, 5);
    }
  }

  if (signals.sellSignal && openSellContracts.length < 5) {
    if (lastProposal?.contract_type === 'PUT') {
      console.log('[🔴] Executing SELL contract at breakdown');
      deriv.buyContract(lastProposal.id, lastProposal.ask_price);
      lastProposal = null;
    } else {
      console.log('[📨] Requesting new SELL proposal');
      deriv.requestTradeProposal('PUT', 10, 5);
    }
  }

  if (latest.close < signals.lowestLow && openBuyContracts.length > 0) {
    console.log('[🚨] STOPLOSS BUY: Closing all BUYs');
    for (const c of openBuyContracts) deriv.buyContract(c.contract_id, 0);
  }

  if (latest.close > signals.highestHigh && openSellContracts.length > 0) {
    console.log('[🚨] STOPLOSS SELL: Closing all SELLs');
    for (const c of openSellContracts) deriv.buyContract(c.contract_id, 0);
  }

  const allBuyProfitable = openBuyContracts.length > 0 && openBuyContracts.every(c => c.profit > 0 && latest.close > signals.lastLowerFractal);
  if (allBuyProfitable) {
    console.log('[💰] PROFIT: Closing all BUYs in profit');
    for (const c of openBuyContracts) deriv.buyContract(c.contract_id, 0);
  }

  const allSellProfitable = openSellContracts.length > 0 && openSellContracts.every(c => c.profit > 0 && latest.close < signals.lastUpperFractal);
  if (allSellProfitable) {
    console.log('[💰] PROFIT: Closing all SELLs in profit');
    for (const c of openSellContracts) deriv.buyContract(c.contract_id, 0);
  }
}

server.listen(PORT, () => {
  console.log(`[✅] PurpleBot backend running on http://localhost:${PORT}`);
});
