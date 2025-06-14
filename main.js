/**
 * PurpleBot-Node by Sanne Karibo
 * Main backend server for trading logic
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const deriv = require('./deriv');         // your deriv.js file
const indicators = require('./indicators');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let tradingInterval = null;
let lastProposal = null;
const TRADE_INTERVAL_MS = 10 * 1000;

// === Chart Data ===
app.get('/api/chart-data', (req, res) => {
  try {
    const candles = deriv.candles || [];
    const activeTrades = Array.from(deriv.openContracts?.values() || []);
    const closedTrades = Array.from(deriv.closedContracts?.values() || []);

    const ema20 = indicators.calculateEMA(candles, 20);
    const rsi7 = indicators.calculateRSI(candles, 7);
    const fractals = indicators.calculateBillWilliamsFractals(candles);

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

// === Condition Checkers ===
function checkBuyConditions() {
  const candles = deriv.candles;
  if (!candles || candles.length < 3) return false;

  const rsi = indicators.calculateRSI(candles, 7);
  const ema = indicators.calculateEMA(candles, 20);
  if (!rsi || !ema) return false;

  const latest = candles[candles.length - 1];
  const prev1 = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  return (
    rsi[rsi.length - 1] > 55 &&
    latest.close > ema[ema.length - 1] &&
    latest.close > prev1.close &&
    latest.close > prev2.close
  );
}

function checkSellConditions() {
  const candles = deriv.candles;
  if (!candles || candles.length < 3) return false;

  const rsi = indicators.calculateRSI(candles, 7);
  const ema = indicators.calculateEMA(candles, 20);
  if (!rsi || !ema) return false;

  const latest = candles[candles.length - 1];
  const prev1 = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  return (
    rsi[rsi.length - 1] < 45 &&
    latest.close < ema[ema.length - 1] &&
    latest.close < prev1.close &&
    latest.close < prev2.close
  );
}

// === Hook Proposal Handler ===
const originalProposalHandler = deriv.handleProposal || (() => {});
deriv.handleProposal = (response) => {
  if (response.proposal) {
    lastProposal = response.proposal;
    console.log('[💡] New proposal:', lastProposal.contract_type, '@', lastProposal.ask_price);
  }
  originalProposalHandler(response);
};

// === Trading Start ===
app.post('/trade-start', (req, res) => {
  if (tradingInterval) return res.status(400).json({ error: 'Trading already running' });

  console.log('[🚀] Starting trading loop...');
  tradingInterval = setInterval(() => {
    try {
      if (checkBuyConditions()) {
        if (lastProposal?.contract_type === 'CALL') {
          console.log('[🟢] Executing CALL...');
          deriv.buyContract(lastProposal.id, lastProposal.ask_price);
          lastProposal = null;
        } else {
          console.log('[📨] Requesting CALL...');
          deriv.requestTradeProposal('CALL', 10, 5);
        }
      } else if (checkSellConditions()) {
        if (lastProposal?.contract_type === 'PUT') {
          console.log('[🔴] Executing PUT...');
          deriv.buyContract(lastProposal.id, lastProposal.ask_price);
          lastProposal = null;
        } else {
          console.log('[📨] Requesting PUT...');
          deriv.requestTradeProposal('PUT', 10, 5);
        }
      } else {
        console.log('[⏳] No trade signal.');
      }
    } catch (err) {
      console.error('[❌] Error in trading loop:', err.message);
    }
  }, TRADE_INTERVAL_MS);

  res.json({ message: 'Trading started' });
});

// === Trading End ===
app.post('/trade-end', (req, res) => {
  if (!tradingInterval) return res.status(400).json({ error: 'Trading not active' });

  clearInterval(tradingInterval);
  tradingInterval = null;
  lastProposal = null;

  console.log('[🛑] Trading stopped.');
  res.json({ message: 'Trading stopped' });
});

// === Set API Token ===
app.post('/set-api-token', (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid token' });
  }

  try {
    fs.writeFileSync('.env', `DERIV_API_TOKEN=${token}\nPORT=${PORT}`);
    console.log('[🔑] DERIV_API_TOKEN updated. Please restart the server.');
    res.json({ message: 'API token saved. Restart server to apply.' });
  } catch (error) {
    console.error('[❌] Failed to write .env:', error.message);
    res.status(500).json({ error: 'Failed to update token' });
  }
});

// === Start Server ===
app.listen(PORT, () => {
  console.log(`[✅] PurpleBot-Node by Sanne Karibo running at http://localhost:${PORT}`);
});
