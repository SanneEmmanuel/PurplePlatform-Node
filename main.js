// main.js — Optimized PurpleBot Server
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import fs from 'fs/promises';
import WebSocket from 'ws';
import deriv from './deriv.js';
import { runPrediction, lastAnalysisResult, loadSparseWeightsFromZip } from './engine/Libra.js';

// --------- Config ---------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = '/tmp';
const WS_UPDATE_INTERVAL = 3000;

// --------- Middleware ---------
app.use(cors(), express.json(), express.static(path.join(__dirname, 'public')));

const upload = multer({ 
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_, file, cb) => cb(null, `model_${Date.now()}${path.extname(file.originalname)}`)
  })
});

// --------- State Management ---------
let botLoop = null;
const activeConnections = new Set();

// --------- WebSocket ---------
wss.on('connection', ws => {
  activeConnections.add(ws);
  const update = () => deriv.getTicksForTraining(300)
    .then(ticks => ws.send(JSON.stringify({
      type: 'update',
      ticks,
      trading: !!botLoop,
      balance: deriv.getAccountBalance(),
      trades: {
        active: [...deriv.openContracts.values()],
        closed: [...deriv.closedContracts.values()]
      }
    })))
    .catch(console.error);

  const interval = setInterval(update, WS_UPDATE_INTERVAL);
  ws.on('close', () => {
    activeConnections.delete(ws);
    clearInterval(interval);
  });
  update();
});

// --------- Helpers ---------
const handleAsync = fn => (req, res) => fn(req, res).catch(e => 
  res.status(500).json({ error: 'Operation failed', details: e.message })
);

const broadcast = data => activeConnections.forEach(ws => 
  ws.send(JSON.stringify(data))
);

// --------- Routes ---------
app.get('/analysis', handleAsync(async (_, res) => 
  res.json(lastAnalysisResult || await runPrediction(await deriv.getTicksForTraining(300)))
));

app.post('/api/predict', handleAsync(async (_, res) => 
  res.json(await runPrediction(await deriv.getTicksForTraining(300)))
));

app.post('/chat', handleAsync(async ({ body: { prompt = '' } }, res) => 
  res.json({ 
    reply: (await axios.post(
      'http://localhost:11434/api/generate', 
      { model: 'tinyllama', prompt, stream: false },
      { timeout: 10000 }
    )).data.response 
  })
));

app.post('/upload-zip', upload.single('model'), handleAsync(async ({ file }, res) => {
  if (!file) throw new Error('No file uploaded');
  await loadSparseWeightsFromZip(null, file.path);
  res.json({ message: 'Model uploaded and loaded' });
}));

app.post('/download-zip', handleAsync(async ({ body: { url } }, res) => {
  if (!url) throw new Error('URL required');
  const zipPath = path.join(UPLOAD_DIR, `model_${Date.now()}.zip`);
  const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  await fs.writeFile(zipPath, data);
  await loadSparseWeightsFromZip(null, zipPath);
  res.json({ message: 'Model downloaded and loaded' });
}));

// --------- Trading Controls ---------
const toggleTrading = (start, res) => {
  if (start === !!botLoop) return res.status(409).json({ error: `Bot already ${start ? 'running' : 'stopped'}` });
  
  if (start) {
    botLoop = setInterval(tradingLogic, 10000);
    tradingLogic();
  } else {
    clearInterval(botLoop);
    botLoop = null;
  }

  broadcast({ type: 'status', trading: start });
  res.json({ message: `Bot ${start ? 'started' : 'stopped'}` });
};

app.post('/trade-start', (_, res) => toggleTrading(true, res));
app.post('/trade-end', (_, res) => toggleTrading(false, res));

// --------- Core Trading Logic ---------
async function tradingLogic() {
  try {
    const { action, reflex } = await runPrediction(await deriv.getTicksForTraining(300));
    if (action !== 'TRADE') return;

    const contractType = reflex.direction > 0 ? 'CALL' : 'PUT';
    const proposal = await deriv.requestTradeProposal(contractType, reflex.size * 10, 5);
    
    if (proposal?.proposal?.id) {
      await deriv.buyContract(proposal.proposal.id, proposal.proposal.ask_price);
      broadcast({ type: 'trade', contract: proposal.proposal });
    }
  } catch (e) {
    console.error('[TRADING ERROR]', e.message);
  }
}

// --------- Server Start ---------
server.listen(PORT, () => {
  console.log(`
  [🚀] PurpleBot AI Trading System
  [📡] WebSocket: ws://localhost:${PORT}
  [🌐] HTTP: http://localhost:${PORT}
  [💰] Deriv API: ${deriv.isConnected ? 'Connected' : 'Disconnected'}`);

  process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    botLoop && clearInterval(botLoop);
    wss.close();
    server.close();
  });
});
