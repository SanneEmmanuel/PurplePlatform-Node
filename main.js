// main.js — Optimized PurpleBot Server with Libra AI + Zip Upload/Download + TinyLlama
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import fs from 'fs';
import { Server as WebSocketServer } from 'ws';
import deriv from './deriv.js';
import {
  runPrediction,
  lastAnalysisResult,
  loadSparseWeightsFromZip
} from './engine/Libra.js';

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
const upload = multer({ dest: '/tmp' });

let botLoop = null, isTrading = false;

// WebSocket: broadcast market state every 3s
wss.on('connection', (ws) => {
  const i = setInterval(async () => {
    try {
      const ticks = await deriv.getTicksForTraining(300);
      ws.send(JSON.stringify({
        type: 'update',
        ticks,
        trading: isTrading,
        balance: deriv.getAccountBalance(),
        trades: {
          active: [...deriv.openContracts.values()],
          closed: [...deriv.closedContracts.values()]
        }
      }));
    } catch (err) {
      console.error('[WS Error]', err.message);
    }
  }, 3000);
  ws.on('close', () => clearInterval(i));
});

// --------- Routes ---------

app.get('/analysis', async (req, res) => {
  try {
    if (!lastAnalysisResult) {
      const ticks = await deriv.getTicksForTraining(300);
      const r = await runPrediction(ticks);
      return res.json(r);
    }
    res.json(lastAnalysisResult);
  } catch (e) {
    res.status(500).json({ error: 'Analysis failed' });
  }
});

app.post('/api/predict', async (req, res) => {
  try {
    const ticks = await deriv.getTicksForTraining(300);
    res.json(await runPrediction(ticks));
  } catch (e) {
    res.status(500).json({ error: 'Prediction failed' });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { prompt = '' } = req.body;
    const { data } = await axios.post('http://localhost:11434/api/generate', {
      model: 'tinyllama', prompt, stream: false
    });
    res.json({ reply: data.response });
  } catch (e) {
    res.status(500).json({ error: 'Chat failed' });
  }
});

app.post('/upload-zip', upload.single('model'), async (req, res) => {
  try {
    await loadSparseWeightsFromZip(null, req.file.path);
    res.json({ message: 'ZIP uploaded and loaded' });
  } catch (e) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/download-zip', async (req, res) => {
  try {
    const { url } = req.body;
    const zipPath = `/tmp/model_${Date.now()}.zip`;
    const writer = fs.createWriteStream(zipPath);
    const response = await axios({ method: 'get', url, responseType: 'stream' });
    response.data.pipe(writer);
    writer.on('finish', async () => {
      await loadSparseWeightsFromZip(null, zipPath);
      res.json({ message: 'ZIP downloaded and loaded' });
    });
    writer.on('error', e => {
      console.error('[❌] Write error', e.message);
      res.status(500).json({ error: 'Download failed' });
    });
  } catch (e) {
    res.status(500).json({ error: 'Download failed' });
  }
});

app.post('/trade-start', (req, res) => {
  if (botLoop) return res.status(409).json({ error: 'Bot already running' });
  isTrading = true;
  botLoop = setInterval(tradingLogic, 10000);
  res.json({ message: 'Bot started' });
});

app.post('/trade-end', (req, res) => {
  if (!botLoop) return res.status(409).json({ error: 'Bot not running' });
  clearInterval(botLoop);
  isTrading = false;
  botLoop = null;
  res.json({ message: 'Bot stopped' });
});

app.get('/api/status', (req, res) => {
  res.json({ trading: isTrading, openContracts: deriv.openContracts.size });
});

app.get('/api/chart-data', async (req, res) => {
  try {
    res.json({ ticks: await deriv.getTicksForTraining(300) });
  } catch (e) {
    res.status(500).json({ error: 'Chart data error' });
  }
});

// --------- Trading Core ---------
async function tradingLogic() {
  try {
    const ticks = await deriv.getTicksForTraining(300);
    const r = await runPrediction(ticks);
    if (r?.action === 'TRADE') {
      const { direction, size } = r.reflex;
      const contractType = direction > 0 ? 'CALL' : 'PUT';
      const p = await deriv.requestTradeProposal(contractType, size * 10, 5);
      if (p?.proposal?.id) {
        await deriv.buyContract(p.proposal.id, p.proposal.ask_price);
        console.log(`[✅] ${contractType} executed`);
      }
    } else {
      console.log('[⌛] No trade — waiting');
    }
  } catch (e) {
    console.error('[Trade Loop Error]', e.message);
  }
}

server.listen(PORT, () => {
  console.log(`[✅] PurpleBot backend running → http://localhost:${PORT}`);
});
