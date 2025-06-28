// main.js - PurpleBot Trading Server
// Dr. Sanne Karibo - Optimized Version

import express from 'express';
import fileUpload from 'express-fileupload';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

// ========== INITIALIZATION ==========
dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(tmpdir(), 'purplebot');
await fs.mkdir(TMP_DIR, { recursive: true });

// ========== MODULE IMPORTS ==========
const deriv = await import('./deriv.js');
const engine = await import('./engine/Libra3.js');
const { 
  requestContractProposal, buyContract, getCurrentPrice, getTicksForTraining,
  getAccountBalance, getAccountInfo, reconnectWithNewSymbol, getAvailableSymbols,
  closedContracts, getAvailableContracts 
} = deriv;
const { runPrediction, tradeAdvice, loadSparseWeightsFromZip, isModelReady, adaptOnFailure} = engine;

// ========== APP CONFIGURATION ==========
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(fileUpload());
app.use(express.static('public'));

// ========== GLOBAL STATE ==========
const globalState = {
  trading: {
    active: false,
    interval: null,
    selectedTrade: 'CALL',
    positionSize: 1,
    maxPositionSize: 16
  },
  lastAdvice: null,
  lastPrediction: null,
  marketMetrics: {
    volatility: 0,
    trend: 'neutral'
  }
};

// ========== HELPER FUNCTIONS ==========
const calculateVolatility = (prices) => {
  const changes = prices.slice(1).map((p, i) => Math.abs(p - prices[i]));
  return changes.reduce((sum, change) => sum + change, 0) / changes.length;
};

const detectTrend = (prices) => {
  const first = prices[0];
  const last = prices[prices.length - 1];
  return last > first ? 'bullish' : last < first ? 'bearish' : 'neutral';
};

const updateMarketMetrics = (prices) => {
  globalState.marketMetrics = {
    volatility: calculateVolatility(prices),
    trend: detectTrend(prices),
    updatedAt: new Date().toISOString()
  };
};

const getAccountStatus = async () => ({
  ...(await getAccountInfo()),
  balance: await getAccountBalance(),
  price: await getCurrentPrice().catch(() => 0),
  tradingStatus: globalState.trading.active ? 'active' : 'inactive',
  position: {
    type: globalState.trading.selectedTrade,
    size: globalState.trading.positionSize
  }
});

const placeTrade = async (tradeType) => {
  const proposal = await requestContractProposal(tradeType, 1, 1);
  const contract = await buyContract(proposal.id, 1);
  console.log(`[TRADE] Executed ${tradeType} at ${contract?.buy?.purchase_time}`);
  return contract;
};

// ========== TRADING LOGIC ==========
const tradingCycle = async () => {
  try {
    if (!isModelReady()) {
      console.warn('[TRADING] Model not ready, skipping cycle');
      return;
    }

    const prices = await getTicksForTraining(300); // Get full 300 ticks
    const prediction = await runPrediction(prices);

    if (!prediction?.predicted || !prediction?.actuals) {
      console.warn('[TRADING] Incomplete prediction data');
      return;
    }

    // Update global state
    globalState.lastPrediction = prediction;
    globalState.lastAdvice = tradeAdvice(
      prediction.predicted,
      prediction.actuals,
      prediction.entryPrice,
      globalState.trading.positionSize,
      globalState.trading.maxPositionSize
    );
    updateMarketMetrics(prediction.actuals);

    console.log('[TRADING] New advice:', globalState.lastAdvice);

    // Trade execution and adaptive learning
    const { action, direction, newPositionSize, outcome } = globalState.lastAdvice;

    if (action === 'add') {
      await placeTrade(direction);
      globalState.trading.selectedTrade = direction;
      globalState.trading.positionSize = newPositionSize;
    } else if (action === 'reduce') {
      globalState.trading.positionSize = newPositionSize;
    }

    // If we lost, retrain immediately
    if (outcome === 'LOSS') {
      console.log("Libra is Learning From Loss");
      await adaptOnFailure(prices, prediction.actuals);
    }

  } catch (err) {
    console.error('[TRADING CYCLE ERROR]', err);
  }
};


// ========== API ENDPOINTS ==========

// Trading Control
app.post('/trade-start', (_, res) => {
  if (globalState.trading.active) return res.json({ status: 'already_active' });
  
  globalState.trading.active = true;
  globalState.trading.interval = setInterval(tradingCycle, 5000);
  res.json({ status: 'activated', interval: '5s' });
});

app.post('/trade-end', (_, res) => {
  globalState.trading.active = false;
  clearInterval(globalState.trading.interval);
  res.json({ status: 'deactivated' });
});

// Trade Execution
['/api/trade-buy', '/api/trade-sell'].forEach(endpoint => {
  app.post(endpoint, async (_, res) => {
    try {
      const type = endpoint.includes('buy') ? 'CALL' : 'PUT';
      res.json(await placeTrade(type));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
});

// Market Data
app.get('/chart-live', async (_, res) => res.json(await getAccountStatus()));
app.get('/chart-data', async (_, res) => res.json(await getTicksForTraining(300)));

// Analysis
app.get('/api/analysis', (_, res) => {
  if (!globalState.lastAdvice) {
    return res.status(404).json({ error: 'No trading data available' });
  }
  
  res.json({
    advice: globalState.lastAdvice,
    prediction: globalState.lastPrediction,
    metrics: globalState.marketMetrics,
    position: {
      current: globalState.trading.positionSize,
      max: globalState.trading.maxPositionSize
    },
    timestamp: new Date().toISOString()
  });
});

// System Management
app.get('/api/symbols', (_, res) => res.json(getAvailableSymbols()));
app.post('/api/set-symbol', async (req, res) => {
  try {
    await reconnectWithNewSymbol(req.body.symbol);
    res.json({ status: 'symbol_updated', symbol: req.body.symbol });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/close-trades', (_, res) => {
  const count = closedContracts.size;
  closedContracts.clear();
  res.json({ closed: count });
});

// File Handling
const handleModelUpload = async (zipPath, res) => {
  try {
    await loadSparseWeightsFromZip(null, zipPath);
    await fs.unlink(zipPath);
    res.json({ status: 'model_loaded' });
  } catch (err) {
    await fs.unlink(zipPath).catch(() => {});
    res.status(500).json({ error: err.message });
  }
};

app.post('/action/upload-zip', async (req, res) => {
  if (!req.files?.model) return res.status(400).json({ error: 'no_file' });
  const zipPath = path.join(TMP_DIR, req.files.model.name);
  await req.files.model.mv(zipPath);
  await handleModelUpload(zipPath, res);
});

app.post('/action/upload-link', async (req, res) => {
  const zipPath = path.join(TMP_DIR, `model-${Date.now()}.zip`);
  try {
    const response = await axios.get(req.body.url, { responseType: 'stream' });
    await pipeline(response.data, fs.createWriteStream(zipPath));
    await handleModelUpload(zipPath, res);
  } catch (err) {
    res.status(400).json({ error: 'download_failed' });
  }
});

// ========== SERVER MANAGEMENT ==========
app.get('/awake', (_, res) => res.send('✅ Server active'));

const keepalive = setInterval(
  () => axios.get(`http://localhost:${PORT}/awake`).catch(() => {}), 
  8.4e5 // 14 minutes
);

process.on('exit', () => {
  clearInterval(keepalive);
  clearInterval(globalState.trading.interval);
  fs.rm(TMP_DIR, { recursive: true }).catch(() => {});
});

app.listen(PORT, () => {
  console.log(`🟢 Server running on port ${PORT}`);
  console.log(`📊 Trading endpoints:
  /trade-start - POST
  /trade-end - POST
  /api/analysis - GET`);
});
