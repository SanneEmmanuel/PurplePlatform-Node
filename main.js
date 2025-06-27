// main.js - PurpleBot server (Updated)
// Dr Sanne Karibo
import express from 'express';
import fileUpload from 'express-fileupload';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { pipeline } from 'stream/promises';

import {
  requestTradeProposal, buyContract,
  getCurrentPrice, getLast100Ticks,
  getAccountBalance, getAccountInfo,
  getTicksForTraining,
  reconnectWithNewSymbol,
  getAvailableSymbols,
  closedContracts,
  getAvailableContracts,
  requestContractProposal
} from './deriv.js';

import {
  runPrediction, lastAnalysisResult,
  loadSparseWeightsFromZip, ready as libraReady
} from './engine/Libra.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const WSPORT = 3001;
const TMP_DIR = '/tmp';
let trading = false, tradingLoop = null;
let selectedTrade = 'CALL';

app.use(cors());
app.use(express.json());
app.use(fileUpload());
app.use(express.static('public'));

const getAccountStatus = async () => {
  const [info, bal, price] = await Promise.all([
    getAccountInfo(),
    getAccountBalance(),
    getCurrentPrice().catch(() => 0)
  ]);
  return {
    fullName: info.fullname || '',
    accountNumber: info.loginid || '',
    accountBalance: bal || 0,
    currentPrice: price || 0,
    tradingStatus: trading ? 'active' : 'inactive',
    selectedTrade
  };
};

const placeTrade = async (type) => {
  const prop = await requestTradeProposal(type, 1, 1);
  buyContract(prop.proposal.id, 1);
};

const wss = new WebSocketServer({ port: WSPORT });
wss.on('connection', ws => {
  console.log('[WS] Connected');
  const loop = setInterval(async () => {
    try {
      ws.send(JSON.stringify(await getAccountStatus()));
    } catch (e) {
      console.error('[WS Error]', e);
    }
  }, 3000);
  ws.on('close', () => clearInterval(loop));
});

app.get('/status', async (req, res) => {
  res.json(await getAccountStatus());
});

const tradingCycle = async () => {
  const prices = await getTicksForTraining(300);
  const { action } = await runPrediction(prices);
  if (action === 'buy' || action === 'sell') {
    await placeTrade(selectedTrade);
  }
};

app.post('/trade-start', async (_, res) => {
  if (trading) return res.json({ message: 'Already trading' });
  trading = true;
  tradingLoop = setInterval(() => tradingCycle().catch(console.error), 5000);
  res.json({ message: 'Trading started' });
});

app.post('/trade-end', (_, res) => {
  trading = false;
  clearInterval(tradingLoop);
  res.json({ message: 'Trading stopped' });
});

const handleTrade = (type) => async (_, res) => {
  try {
    await placeTrade(type);
    res.json({ type: type.toLowerCase(), success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.post('/api/trade-buy', handleTrade('CALL'));
app.post('/api/trade-sell', handleTrade('PUT'));

app.post('/api/close-trades', async (_, res) => {
  try {
    let closed = 0;
    for (const [id] of closedContracts) {
      closedContracts.delete(id);
      closed++;
    }
    res.json({ message: `Manually cleared ${closed} closed trades.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let derivReady = false;
const waitUntilReady = async () => {
  while (!derivReady || !libraReady) {
    await new Promise(r => setTimeout(r, 500));
  }
};

app.get('/chart-data', async (_, res) => {
  try {
    await waitUntilReady();
    res.json(await getTicksForTraining(300));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analysis', (_, res) => {
  res.json(lastAnalysisResult || { message: 'No analysis yet' });
});

app.get('/api/symbols', async (_, res) => {
  try {
    res.json(getAvailableSymbols());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/set-symbol', async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });
    await reconnectWithNewSymbol(symbol);
    res.json({ message: 'Symbol changed', symbol });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/check-deals', async (_, res) => {
  try {
    const contracts = await getAvailableContracts();
    res.json(contracts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/set-deals', async (req, res) => {
  const { trade } = req.body;
  if (!trade) return res.status(400).json({ error: 'Missing trade type' });
  selectedTrade = trade.toUpperCase();
  res.json({ message: `Trade type set to ${selectedTrade}` });
});

app.post('/chat', (req, res) => {
  res.json({ response: `Hello I'm Libra, You said "${req.body.message}"` });
});

const handleZipUpload = async (zipPath, res, successMessage) => {
  try {
    await loadSparseWeightsFromZip(null, zipPath);
    res.json({ message: successMessage, path: zipPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.post('/action/upload-zip', async (req, res) => {
  const file = req.files?.model;
  if (!file) return res.status(400).send('No file');
  const zipPath = path.join(TMP_DIR, file.name);
  await file.mv(zipPath);
  await handleZipUpload(zipPath, res, 'Weights loaded');
});

app.post('/action/upload-link', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });
  const zipPath = path.join(TMP_DIR, 'model_from_link.zip');
  try {
    const response = await axios({ url, responseType: 'stream' });
    await pipeline(response.data, fs.createWriteStream(zipPath));
    await handleZipUpload(zipPath, res, 'Weights loaded from link');
  } catch (err) {
    res.status(500).json({ error: 'Download failed: ' + err.message });
  }
});

app.get('/awake', (_, res) => res.send('✅ Awake'));
setInterval(() => axios.get(`http://localhost:${PORT}/awake`).catch(() => {}), 8.4e5);

import('./deriv.js').then(() => { derivReady = true; });

app.listen(PORT, () => {
  console.log(`🟢 http://localhost:${PORT}`);
  console.log(`🌐 ws://localhost:${WSPORT}`);
});
