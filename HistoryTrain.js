// HistoryTrain.js - Full-Day AI Training with Echo Upload
// Author: Dr. Sanne Karibo – PurpleBot AI Core

import { getTicksForTraining } from './deriv.js';
import {
  trainShadowModel,
  getSparseWeights,
  loadSparseWeights,
  buildModel,
  storage
} from './engine/Libra.js';

import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

const SECONDS_IN_A_DAY = 86400;
const CHUNK_SIZE = 300;
const today = new Date().toISOString().split('T')[0];

// 🧠 Convert raw candles into gzip-compressed Echo buffer
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

// ⛏️ Slice historical data into Echo training chunks
async function getLargeHistoricalChunks(chunkSize = CHUNK_SIZE, total = SECONDS_IN_A_DAY) {
  const all = await getTicksForTraining(total);
  const buffers = [];

  for (let i = 0; i < all.length; i += chunkSize) {
    const chunk = all.slice(i, i + chunkSize);
    if (chunk.length === chunkSize) {
      buffers.push(toEchoBuffer(chunk));
    }
  }

  return buffers;
}

// ☁️ Upload Echo buffers to Firebase Cloud Storage
async function uploadEchoes(buffers) {
  const basePath = `echoes/${today}`;
  for (let i = 0; i < buffers.length; i++) {
    const file = storage.file(`${basePath}/echo_${i}.bin`);
    const [exists] = await file.exists();
    if (!exists) {
      await file.save(buffers[i], {
        metadata: { contentType: 'application/octet-stream' }
      });
      console.log(`[📡] Uploaded Echo ${i + 1}/${buffers.length}`);
    } else {
      console.log(`[⏭️] Echo ${i + 1} already exists — skipping`);
    }
  }
}

// ☁️ Upload sparse delta weights to Firebase Cloud Storage
async function saveSparseToFirebase(deltas) {
  const file = storage.file(`model/hunter/weights_sparse_latest.bin`);
  const compressed = zlib.gzipSync(JSON.stringify(deltas));
  await file.save(compressed, {
    metadata: { contentType: 'application/octet-stream' }
  });
  console.log('[☁️] Sparse weights uploaded to Firebase');
}

// 📂 Ensure local model path exists
function ensureLocalModelPath() {
  const dir = path.resolve('model/hunter');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('[📁] Created model directory:', dir);
  }
}

// 🚀 Main Execution
async function main() {
  console.time('[⏱️] Total Training Time');
  console.log(`[📦] Fetching ${SECONDS_IN_A_DAY} ticks from history...`);

  const buffers = await getLargeHistoricalChunks(CHUNK_SIZE, SECONDS_IN_A_DAY);
  console.log(`[🔩] ${buffers.length} Echo chunks prepared`);

  ensureLocalModelPath();
  await uploadEchoes(buffers);

  const base = buildModel();
  await loadSparseWeights(base, 'hunter');

  console.log('[🧠] Training model on Echo buffers...');
  const trained = await trainShadowModel(buffers);

  console.log('[🧬] Calculating sparse deltas...');
  const deltas = await getSparseWeights(base, trained);

  await saveSparseToFirebase(deltas);

  console.timeEnd('[⏱️] Total Training Time');
  console.log('[✅] Training completed successfully');
}

main().catch(e => console.error('[❌] Training Error:', e));
