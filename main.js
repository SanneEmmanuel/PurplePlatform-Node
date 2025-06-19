// main.js (Improved and Structured PurpleBot Backend)
// PurpleBot by Sanne Karibo

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('ws');
const cors = require('cors');

const deriv = require('./deriv');
const indicators = require('./indicators');

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Runtime state
let tradingInterval = null;
let isBotTrading = false;
let lastProposal = null;
const TRADE_INTERVAL = 10000;
const MAX_TRADES = 5;

wss.on('connection', (socket) => {
  console.log('[🌐] WebSocket client connected');

  const interval = setInterval(async () => {
    const indicatorData = await gatherIndicatorData();
    const data = {
      type: 'update',
      candles: deriv.candles,
      indicators: indicatorData,
      trades: {
        active: Array.from(deriv.openContracts.values()),
        closed: Array.from(deriv.closedContracts.values())
      },
      balance: deriv.getAccountBalance(),
      trading: isBotTrading
    };

    try {
      socket.send(JSON.stringify(data));
    } catch (err) {
      console.error('[❌] WebSocket send error:', err.message);
    }
  }, 3000);

  socket.on('close', () => clearInterval(interval));
});

app.post('/trade-start', (req, res) => {
  if (tradingInterval) return res.status(409).json({ error: 'Bot is already running' });
  console.log('[🚀] Starting trading bot...');
  isBotTrading = true;
  tradingInterval = setInterval(tradingLoop, TRADE_INTERVAL);
  res.json({ message: 'Bot started' });
});

app.post('/trade-end', (req, res) => {
  if (!tradingInterval) return res.status(409).json({ error: 'Bot not running' });
  clearInterval(tradingInterval);
  tradingInterval = null;
  isBotTrading = false;
  console.log('[🐝] Bot stopped.');
  res.json({ message: 'Bot stopped' });
});

app.get('/api/status', (req, res) => {
  res.json({ trading: isBotTrading, openContracts: deriv.openContracts.size });
});

app.get('/api/account-info', (req, res) => {
  const info = deriv.getAccountInfo();
  if (!info || !info.loginid) return res.status(404).json({ error: 'Unauthorized' });
  res.json(info);
});

app.get('/api/balance', (req, res) => {
  const balance = deriv.getAccountBalance();
  if (balance == null) return res.status(202).json({ message: 'Balance loading' });
  res.json({ balance });
});

// ✅ MODIFIED: Return only candles
app.get('/api/chart-data', async (req, res) => {
  res.json({ candles: deriv.candles });
});

// ✅ NEW: Return only indicators
app.get('/api/indicators', async (req, res) => {
  try {
    const indicatorsData = await gatherIndicatorData();
    res.json({ indicators: indicatorsData });
  } catch (err) {
    console.error('Error fetching indicators:', err.message);
    res.status(500).json({ error: 'Failed to fetch indicators' });
  }
});

// ✅ NEW: Return only active trades
app.get('/api/active-trades', (req, res) => {
  try {
    const activeTrades = Array.from(deriv.openContracts.values());
    res.json({ activeTrades });
  } catch (err) {
    console.error('Error fetching active trades:', err.message);
    res.status(500).json({ error: 'Failed to fetch active trades' });
  }
});

// ✅ NEW: Simple health check endpoint
app.get('/ping', (req, res) => {
  res.send('🟢 PurpleBot backend is alive and well!');
});

app.get('/symbol-info', (req, res) => {
  res.json({
    currentSymbol: deriv.getCurrentSymbol(),
    availableSymbols: deriv.getAvailableSymbols(),
    symbolDetails: deriv.getSymbolDetails()
  });
});

app.post('/set-symbol', async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });
  const validSymbols = deriv.getAvailableSymbols();
  if (!validSymbols.includes(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
  await updateEnv('SYMBOL', symbol);
  deriv.reconnectWithNewSymbol(symbol);
  res.json({ message: 'Symbol updated' });
});

// === Helper Functions ===

async function updateEnv(key, value) {
  const envPath = path.join(__dirname, '.env');
  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch {}
  const lines = content.split('\n').filter(Boolean);
  const updated = lines.map(line => (line.startsWith(key + '=') ? `${key}=${value}` : line));
  if (!lines.some(line => line.startsWith(key + '='))) updated.push(`${key}=${value}`);
  await fs.writeFile(envPath, updated.join('\n'));
  process.env[key] = value;
}

async function gatherIndicatorData() {
  const ema20 = await indicators.calculateEMA(deriv.candles, 20);
  const rsi7 = await indicators.calculateRSI(deriv.candles, 7);
  const fractals = await indicators.calculateBillWilliamsFractals(deriv.candles);
  return { ema20, rsi7, ...fractals };
}

async function tradingLoop() {
  const candles = deriv.candles;
  if (!candles || candles.length < 20) return;

  const ema20 = indicators.calculateEMA(candles, 20);
  const rsi7 = indicators.calculateRSI(candles, 7);
  const lastCandle = candles.at(-1);
  const prevCandle = candles.at(-2);

  if (!lastCandle || !prevCandle || !ema20 || !rsi7) return;
  const openBuys = Array.from(deriv.openContracts.values()).filter(c => c.contract_type === 'CALL');
  const openSells = Array.from(deriv.openContracts.values()).filter(c => c.contract_type === 'PUT');

  // BUY SIGNAL
  if (rsi7.at(-2) > 55 && prevCandle.close > ema20.at(-2) && openBuys.length < MAX_TRADES) {
    console.log('[📈] BUY Signal Detected');
    const proposal = await deriv.requestTradeProposal('CALL', 10, 5);
    if (proposal?.proposal?.id) {
      await deriv.buyContract(proposal.proposal.id, proposal.proposal.ask_price);
      console.log('[✅] Executed CALL Contract');
    }
  }

  // SELL SIGNAL
  if (rsi7.at(-2) < 45 && prevCandle.close < ema20.at(-2) && openSells.length < MAX_TRADES) {
    console.log('[📉] SELL Signal Detected');
    const proposal = await deriv.requestTradeProposal('PUT', 10, 5);
    if (proposal?.proposal?.id) {
      await deriv.buyContract(proposal.proposal.id, proposal.proposal.ask_price);
      console.log('[✅] Executed PUT Contract');
    }
  }
}

// Start Server
server.listen(PORT, () => {
  console.log(`[✅] PurpleBot backend running at http://localhost:${PORT}`);
});
