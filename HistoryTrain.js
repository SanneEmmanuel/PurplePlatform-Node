// HistoryTrain.js - Incremental AI Training from ZIP in Google Drive
// Author: Dr. Sanne Karibo – PurpleBot AI Core (AI Name: Sanne-junior)

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import unzipper from 'unzipper';
import archiver from 'archiver';
import { getTicksForTraining } from './deriv.js';
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
    ticks: candles.map(({ open, high, low, close }) => ({ open, high, low, close }))
  }));
}

async function getTrainingChunks(chunkSize = CHUNK_SIZE, seconds = SECONDS_IN_A_DAY) {
  const days = parseInt(process.argv[2]) || 1;
  const allTicks = await getTicksForTraining(seconds * days);
  return Array.from({ length: Math.floor(allTicks.length / chunkSize) }, (_, i) => {
    const chunk = allTicks.slice(i * chunkSize, (i + 1) * chunkSize);
    return toEchoBuffer(chunk);
  });
}

async function extractZip(zipPath, extractTo) {
  if (!fs.existsSync(zipPath)) return;
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractTo }))
      .on('close', resolve)
      .on('error', reject);
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[📁] Sanne-junior: Created directory ${dir}`);
  }
}

async function zipModelDir(source, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    archive.directory(source, false);
    archive.finalize();
    output.on('close', resolve);
    archive.on('error', reject);
  });
}

async function main() {
  console.time('[⏱️] Sanne-junior: Training Time');
  ensureDir(MODEL_DIR);

  if (fs.existsSync(ZIP_PATH)) {
    console.log('[📦] Sanne-junior: Extracting previous model from Drive...');
    await extractZip(ZIP_PATH, MODEL_DIR);
  } else {
    console.log('[⚠️] Sanne-junior: No model found. Starting fresh...');
  }

  const echoBuffers = await getTrainingChunks();
  console.log(`[🧠] Sanne-junior: Prepared ${echoBuffers.length} echo buffers`);

  const baseModel = buildModel();
  await loadSparseWeights(baseModel, 'hunter');

  console.log('[🔥] Sanne-junior: Training in progress...');
  const trainedModel = await trainShadowModel(echoBuffers);

  console.log('[🔬] Sanne-junior: Extracting sparse updates...');
  const deltas = await getSparseWeights(baseModel, trainedModel);

  const sparsePath = path.join(MODEL_DIR, 'weights_sparse_latest.bin');
  const compressed = zlib.gzipSync(JSON.stringify(deltas));
  fs.writeFileSync(sparsePath, compressed);
  console.log('[💾] Sanne-junior: Saved weights locally');

  await zipModelDir(MODEL_DIR, ZIP_PATH);
  console.log('[☁️] Sanne-junior: Model ZIP updated on Drive');

  console.timeEnd('[⏱️] Sanne-junior: Training Time');
  console.log('[✅] Sanne-junior: Training complete');
}

main().catch(e => console.error('[❌] Sanne-junior: Error during training:', e)));
