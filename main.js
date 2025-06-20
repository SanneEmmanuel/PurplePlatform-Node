// main.js (ESM-Compatible & Libra-Ready)
// PurpleBot by Dr. Sanne Karibo

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';
import http from 'http';
import { Server as WebSocketServer } from 'ws';
import cors from 'cors';

import deriv from './deriv.js';
import indicators from './indicators.js';
import { runPrediction, evolveModels } from './engine/Libra.js';

// Path helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let tradingInterval = null;
let isBotTrading = false;
const TRADE_INTERVAL = 10000;

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

app.get('/api/predict', async (req, res) => {
  try {
    const ticks = await deriv.getTicksForTraining(300);
    const result = await runPrediction(ticks);
    res.json(result);
  } catch (err) {
    console.error('[❌] Prediction error:', err.message);
    res.status(500).json({ error: 'Prediction failed' });
  }
});

app.post('/api/train', async (req, res) => {
  try {
    await evolveModels();
    res.json({ message: 'Training complete' });
  } catch (err) {
    console.error('[❌] Training error:', err.message);
    res.status(500).json({ error: 'Training failed' });
  }
});

app.get('/api/chart-data', (req, res) => {
  res.json({ candles: deriv.candles });
});

app.get('/api/indicators', async (req, res) => {
  try {
    const indicatorsData = await gatherIndicatorData();
    res.json({ indicators: indicatorsData });
  } catch (err) {
    console.error('Error fetching indicators:', err.message);
    res.status(500).json({ error: 'Failed to fetch indicators' });
  }
});

app.get('/api/current-price', async (req, res) => {
  try {
    const price = await deriv.getCurrentPrice();
    res.json({ price, symbol: deriv.getCurrentSymbol() });
  } catch (err) {
    console.error('Error fetching current price:', err.message);
    res.status(500).json({ error: 'Failed to fetch current price' });
  }
});

app.get('/api/ticks-for-training', async (req, res) => {
  const count = parseInt(req.query.count) || 1000;
  try {
    const ticks = await deriv.getTicksForTraining(count);
    res.json({ ticks, symbol: deriv.getCurrentSymbol() });
  } catch (err) {
    console.error('Error fetching training ticks:', err.message);
    res.status(400).json({ error: err.message });
  }
});

async function gatherIndicatorData() {
  const ema20 = await indicators.calculateEMA(deriv.candles, 20);
  const rsi7 = await indicators.calculateRSI(deriv.candles, 7);
  const fractals = await indicators.calculateBillWilliamsFractals(deriv.candles);
  return { ema20, rsi7, ...fractals };
}

async function tradingLoop() {
  try {
    const ticks = await deriv.getTicksForTraining(300);
    const result = await runPrediction(ticks);

    if (result?.action === 'TRADE') {
      const { direction, size, tp } = result.reflex;
      const contractType = direction > 0 ? 'CALL' : 'PUT';
      const proposal = await deriv.requestTradeProposal(contractType, size * 10, 5);

      if (proposal?.proposal?.id) {
        await deriv.buyContract(proposal.proposal.id, proposal.proposal.ask_price);
        console.log(`[✅] Executed ${contractType} based on reflex AI`);
      }
    } else {
      console.log('[⌛] Waiting — no urgent prediction.');
    }
  } catch (err) {
    console.error('[❌] Error in trading loop:', err.message);
  }
}

server.listen(PORT, () => {
  console.log(`[✅] PurpleBot backend running at http://localhost:${PORT}`);
});
