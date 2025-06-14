/**
 * PurpleBot-Node by Sanne Karibo
 * Main backend server for trading logic
 */

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const dotenv = require('dotenv');
const deriv = require('./deriv');
const indicators = require('./indicators');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let tradingInterval = null;
let lastProposal = null;
const TRADE_INTERVAL_MS = 10 * 1000;

// === Utility Functions ===
async function updateEnvVariable(key, value) {
  const envPath = path.join(__dirname, '.env');
  try {
    let envContent = '';
    
    try {
      envContent = await fs.readFile(envPath, 'utf8');
    } catch (readErr) {
      if (readErr.code !== 'ENOENT') throw readErr;
    }
    
    const lines = envContent.split('\n');
    let found = false;
    const newLines = lines.map(line => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    
    if (!found) {
      newLines.push(`${key}=${value}`);
    }
    
    await fs.writeFile(envPath, newLines.join('\n'));
    return true;
  } catch (error) {
    console.error(`[❌] Failed to update ${key}:`, error.message);
    throw error;
  }
}

// === Chart Data ===
app.get('/api/chart-data', async (req, res) => {
  try {
    const candles = deriv.candles || [];
    const activeTrades = Array.from(deriv.openContracts?.values() || []);
    const closedTrades = Array.from(deriv.closedContracts?.values() || []);
    
    if (candles.length < 20) {
      return res.json({
        candles,
        activeTrades,
        closedTrades,
        indicators: {}
      });
    }

    // Calculate indicators in parallel
    const [ema20, rsi7, fractals] = await Promise.all([
      indicators.calculateEMA(candles, 20),
      indicators.calculateRSI(candles, 7),
      indicators.calculateBillWilliamsFractals(candles)
    ]);

    res.json({
      candles,
      activeTrades,
      closedTrades,
      indicators: {
        ema20,
        rsi7,
        fractalHighs: fractals.fractalHighs,
        fractalLows: fractals.fractalLows,
      },
    });
  } catch (error) {
    console.error('[❗] Error in /api/chart-data:', error.message);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

// === Symbol Management ===
app.get('/symbol-info', (req, res) => {
  res.json({
    currentSymbol: deriv.getCurrentSymbol(),
    availableSymbols: deriv.getAvailableSymbols()
  });
});

app.post('/set-symbol', async (req, res) => {
  const { symbol } = req.body;
  
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ 
      error: 'Invalid symbol format',
      availableSymbols: deriv.getAvailableSymbols() 
    });
  }

  const availableSymbols = deriv.getAvailableSymbols();
  if (!availableSymbols.includes(symbol)) {
    return res.status(400).json({ 
      error: 'Invalid symbol', 
      availableSymbols 
    });
  }

  try {
    await updateEnvVariable('SYMBOL', symbol);
    deriv.reconnectWithNewSymbol(symbol);
    
    res.json({ 
      message: 'Symbol updated and connection refreshed',
      currentSymbol: symbol
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to update symbol',
      availableSymbols
    });
  }
});

// === Trading Signal Detection ===
function getTradingSignals() {
  const candles = deriv.candles;
  if (!candles || candles.length < 20) return null;

  try {
    const rsi = indicators.calculateRSI(candles, 7);
    const ema = indicators.calculateEMA(candles, 20);
    if (!rsi || rsi.length < 1 || !ema || ema.length < 1) return null;

    const latest = candles[candles.length - 1];
    const prev1 = candles[candles.length - 2];
    const prev2 = candles[candles.length - 3];

    const buySignal = (
      rsi[rsi.length - 1] > 55 &&
      latest.close > ema[ema.length - 1] &&
      latest.close > prev1.close &&
      latest.close > prev2.close
    );

    const sellSignal = (
      rsi[rsi.length - 1] < 45 &&
      latest.close < ema[ema.length - 1] &&
      latest.close < prev1.close &&
      latest.close < prev2.close
    );

    return { buySignal, sellSignal };
  } catch (error) {
    console.error('[❌] Error calculating trading signals:', error);
    return null;
  }
}

// === Proposal Handler ===
let originalProposalHandler = deriv.handleProposal;
deriv.handleProposal = (response) => {
  if (response.proposal) {
    lastProposal = response.proposal;
    console.log(`[💡] New ${lastProposal.contract_type} proposal @ ${lastProposal.ask_price}`);
  }
  if (typeof originalProposalHandler === 'function') {
    originalProposalHandler(response);
  }
};

// === Trading Control ===
function tradingLoop() {
  try {
    const signals = getTradingSignals();
    if (!signals) return;

    const { buySignal, sellSignal } = signals;

    if (buySignal) {
      if (lastProposal?.contract_type === 'CALL') {
        console.log('[🟢] Executing CALL...');
        deriv.buyContract(lastProposal.id, lastProposal.ask_price);
        lastProposal = null;
      } else {
        console.log('[📨] Requesting CALL proposal...');
        deriv.requestTradeProposal('CALL', 10, 5);
      }
    } else if (sellSignal) {
      if (lastProposal?.contract_type === 'PUT') {
        console.log('[🔴] Executing PUT...');
        deriv.buyContract(lastProposal.id, lastProposal.ask_price);
        lastProposal = null;
      } else {
        console.log('[📨] Requesting PUT proposal...');
        deriv.requestTradeProposal('PUT', 10, 5);
      }
    }
  } catch (err) {
    console.error('[❌] Error in trading loop:', err.message);
  }
}

app.post('/trade-start', (req, res) => {
  if (tradingInterval) {
    return res.status(409).json({ error: 'Trading already running' });
  }

  console.log('[🚀] Starting trading loop...');
  tradingInterval = setInterval(tradingLoop, TRADE_INTERVAL_MS);
  res.json({ message: 'Trading started' });
});

app.post('/trade-end', (req, res) => {
  if (!tradingInterval) {
    return res.status(409).json({ error: 'Trading not active' });
  }

  clearInterval(tradingInterval);
  tradingInterval = null;
  lastProposal = null;

  console.log('[🛑] Trading stopped.');
  res.json({ message: 'Trading stopped' });
});

// === API Token Management ===
app.post('/set-api-token', async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string' || token.length < 20) {
    return res.status(400).json({ error: 'Invalid token format' });
  }

  try {
    await updateEnvVariable('DERIV_API_TOKEN', token);
    deriv.reconnectWithNewToken(token);
    
    res.json({ message: 'API token updated and connection refreshed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update token' });
  }
});

// === Error Handling Middleware ===
app.use((err, req, res, next) => {
  console.error('[🔥] Server Error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// === Start Server ===
app.listen(PORT, () => {
  console.log(`[✅] PurpleBot-Node running at http://localhost:${PORT}`);
  console.log(`[ℹ️] Current symbol: ${deriv.getCurrentSymbol()}`);
});
