// main.js
// PurpleBot by Dr Sanne Karibo

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

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let tradingInterval = null;
let lastProposal = null;
const TRADE_INTERVAL_MS = 10 * 1000;

// === WebSocket Broadcast ===
wss.on('connection', (socket) => {
  console.log('[🌐] WebSocket client connected');

  const sendLiveData = async () => {
    const candles = deriv.candles || [];
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

// === API Routes ===

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

app.get('/symbol-info', (req, res) => {
  res.json({
    currentSymbol: deriv.getCurrentSymbol(),
    availableSymbols: deriv.getAvailableSymbols(),
    symbolDetails: deriv.getSymbolDetails()
  });
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

app.get('/api/balance', (req, res) => {
  try {
    deriv.requestBalance();
    const balance = deriv.getAccountBalance();
    if (balance === null) return res.status(202).json({ message: 'Fetching balance...' });
    res.json({ balance });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve balance' });
  }
});

async function updateEnvVariable(key, value) {
  const envPath = path.join(__dirname, '.env');
  try {
    let content = '';
    try { content = await fs.readFile(envPath, 'utf8'); } catch {}
    const lines = content.split('\n');
    const updated = lines.map(line => (line.startsWith(key + '=') ? `${key}=${value}` : line));
    if (!lines.some(line => line.startsWith(key + '='))) updated.push(`${key}=${value}`);
    await fs.writeFile(envPath, updated.join('\n'));
  } catch (err) {
    console.error(`[❌] Failed to update ${key}:`, err.message);
    throw err;
  }
}

// === Start Server ===
server.listen(PORT, () => {
  console.log(`[✅] PurpleBot backend running on http://localhost:${PORT}`);
});
