// HistoryTrain.js - Incremental AI Training from ZIP in Google Drive
// Author: Dr. Sanne Karibo – PurpleBot AI Core

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import unzipper from 'unzipper';
import archiver from 'archiver';
import {
  getTicksForTraining
} from './deriv.js';

import {
  trainShadowModel,
  getSparseWeights,
  loadSparseWeights,
  buildModel
} from './engine/Libra.js';

const ZIP_PATH = '/content/drive/MyDrive/libra_model.zip';
const MODEL_DIR = './model/hunter';
const CHUNK_SIZE = 300;
const SECONDS_IN_A_DAY = 86400;

function toEchoBuffer(candles) {
  return zlib.gzipSync(JSON.stringify({
    ticks: candles.map(c => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }))
  }));
}

async function getTrainingChunks(chunkSize = CHUNK_SIZE, total = SECONDS_IN_A_DAY) {
  // ⏱️ Read number of days from command line (default = 1)
const days = parseInt(process.argv[2]) || 1;
  const all = await getTicksForTraining(total*days);
  const buffers = [];
  for (let i = 0; i < all.length; i += chunkSize) {
    const chunk = all.slice(i, i + chunkSize);
    if (chunk.length === chunkSize) {
      buffers.push(toEchoBuffer(chunk));
    }
  }
  return buffers;
}

async function extractZip(zipPath, extractTo) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractTo }))
      .on('close', resolve)
      .on('error', reject);
  });
}

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    console.log('[📁] Created:', p);
  }
}

async function zipModelDir(sourceDir, outPath) {
  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();

    output.on('close', resolve);
    archive.on('error', reject);
  });
}

async function main() {
  console.time('[⏱️] Total Training Time');
  ensureDir(MODEL_DIR);

  // 🔁 Attempt to load previous model
  if (fs.existsSync(ZIP_PATH)) {
    console.log('[📦] Loading existing model ZIP from Drive...');
    await extractZip(ZIP_PATH, MODEL_DIR);
  } else {
    console.log('[⚠️] No existing ZIP found — starting afresh...');
  }

  const echoBuffers = await getTrainingChunks();
  console.log(`[🧠] ${echoBuffers.length} Echo chunks prepared`);

  const baseModel = buildModel();
  await loadSparseWeights(baseModel, 'hunter');

  console.log('[🔥] Training model on new data...');
  const trainedModel = await trainShadowModel(echoBuffers);

  console.log('[🔬] Calculating sparse updates...');
  const deltas = await getSparseWeights(baseModel, trainedModel);

  // Save sparse weights locally
  const sparsePath = path.join(MODEL_DIR, 'weights_sparse_latest.bin');
  const compressed = zlib.gzipSync(JSON.stringify(deltas));
  fs.writeFileSync(sparsePath, compressed);
  console.log('[💾] Weights saved locally');

  // Zip and update Drive
  await zipModelDir(MODEL_DIR, ZIP_PATH);
  console.log('[☁️] Updated model ZIP saved to Drive');

  console.timeEnd('[⏱️] Total Training Time');
  console.log('[✅] Incremental training complete');
}

main().catch(e => console.error('[❌] Training Error:', e));
