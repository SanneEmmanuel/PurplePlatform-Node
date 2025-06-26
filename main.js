// main.js - PurpleBot server
//v2.0 By Dr Sanne Karibo
import express from 'express';
import fileUpload from 'express-fileupload';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';

import {
  requestTradeProposal, buyContract,
  getCurrentPrice, getLast100Ticks,
  getAccountBalance, getAccountInfo
} from './deriv.js';

import {
  runPrediction, lastAnalysisResult,
  loadSparseWeightsFromZip
} from './engine/libra.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const WSPORT = 3001;
let trading = false, tradingLoop = null;

app.use(cors());
app.use(express.json());
app.use(fileUpload());
app.use(express.static('public'));

// WebSocket Stream
const wss = new WebSocketServer({ port: WSPORT });
wss.on('connection', ws => {
  console.log('[WS] Connected');
  const loop = setInterval(async () => {
    try {
      const [info, bal, price] = await Promise.all([
        getAccountInfo(), 
        getAccountBalance(),
        getCurrentPrice().catch(() => 0)
      ]);
      ws.send(JSON.stringify({
        fullName: info.fullname || '', 
        accountNumber: info.loginid || '',
        accountBalance: bal || 0, 
        currentPrice: price || 0,
        tradingStatus: trading ? 'active' : 'inactive'
      }));
    } catch (e) {
      console.error('[WS Error]', e);
    }
  }, 3000);
  ws.on('close', () => clearInterval(loop));
});

// Status
app.get('/status', async (req, res) => {
  const info = getAccountInfo(), bal = getAccountBalance();
  const price = await getCurrentPrice().catch(() => 0);
  res.json({
    fullName: info.fullname || '', accountNumber: info.loginid || '',
    accountBalance: bal || 0, currentPrice: price || 0,
    tradingStatus: trading ? 'active' : 'inactive'
  });
});

// Start AI Trading
app.post('/trade-start', async (_, res) => {
  if (trading) return res.json({ message: 'Already trading' });
  trading = true;
  tradingLoop = setInterval(async () => {
    try {
      const prices = await getLast100Ticks();
      const { action } = await runPrediction(prices);
      if (action === 'buy' || action === 'sell') {
        const type = action === 'buy' ? 'CALL' : 'PUT';
        const prop = await requestTradeProposal(type, 1, 1);
        buyContract(prop.proposal.id, 1);
      }
    } catch {}
  }, 5000);
  res.json({ message: 'Trading started' });
});

// Stop Trading
app.post('/trade-end', (_, res) => {
  trading = false;
  clearInterval(tradingLoop);
  res.json({ message: 'Trading stopped' });
});

// Manual Buy/Sell
app.post('/api/trade-buy', async (_, res) => {
  try {
    const prop = await requestTradeProposal('CALL', 1, 1);
    buyContract(prop.proposal.id, 1);
    res.json({ type: 'buy', success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/trade-sell', async (_, res) => {
  try {
    const prop = await requestTradeProposal('PUT', 1, 1);
    buyContract(prop.proposal.id, 1);
    res.json({ type: 'sell', success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/close-trades', (_, res) => {
  res.json({ message: 'Manual close-trade not implemented.' });
});

// AI Analysis
app.get('/api/analysis', (_, res) => {
  res.json(lastAnalysisResult || { message: 'No analysis yet' });
});

// Libra Chat (Stub)
app.post('/chat', (req, res) => {
  res.json({ response: `Libra: You said "${req.body.message}"` });
});

// Upload ZIP (file)
app.post('/action/upload-zip', async (req, res) => {
  const file = req.files?.model;
  if (!file) return res.status(400).send('No file');
  const zipPath = path.join('/tmp', file.name);
  try {
    await file.mv(zipPath);
    await loadSparseWeightsFromZip(null, zipPath);
    res.json({ message: 'Weights loaded', path: zipPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload ZIP (from link)
app.post('/action/upload-link', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });
  const zipPath = '/tmp/model_from_link.zip';
  const writer = fs.createWriteStream(zipPath);
  try {
    const stream = await axios({ method: 'GET', url, responseType: 'stream' });
    stream.data.pipe(writer);
    writer.on('finish', async () => {
      try {
        await loadSparseWeightsFromZip(null, zipPath);
        res.json({ message: 'Weights loaded from link', path: zipPath });
      } catch (err) {
        res.status(500).json({ error: 'Load failed: ' + err.message });
      }
    });
    writer.on('error', () => res.status(500).json({ error: 'Write failed' }));
  } catch (err) {
    res.status(500).json({ error: 'Download failed: ' + err.message });
  }
});

// Keep server alive
app.get('/awake', (_, res) => res.send('✅ Awake'));
setInterval(() => {
  axios.get(`http://localhost:${PORT}/awake`).catch(() => {});
}, 1000 * 60 * 14);

// Start
app.listen(PORT, () => {
  console.log(`🟢 http://localhost:${PORT}`);
  console.log(`🌐 ws://localhost:${WSPORT}`);
});
