// HistoryTrain.js - Incremental AI Training from ZIP in Google Drive
// AI Identity: Sanne-junior (by Dr. Sanne Karibo)

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
const AI_NAME = 'Sanne-junior';

function toEchoBuffer(candles) {
  const ticks = candles.map(c => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
  }));
  return zlib.gzipSync(JSON.stringify({ ticks }));
}

async function getTrainingChunks(chunkSize = CHUNK_SIZE, total = SECONDS_IN_A_DAY) {
  const days = parseInt(process.argv[2]) || 1;
  const allTicks = await getTicksForTraining(total * days);
  const buffers = [];

  for (let i = 0; i < allTicks.length; i += chunkSize) {
    const chunk = allTicks.slice(i, i + chunkSize);
    if (chunk.length === chunkSize) {
      buffers.push(toEchoBuffer(chunk));
    }
  }

  return buffers;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    console.log(`[📁] ${AI_NAME}: Created directory -> ${p}`);
  }
}

async function extractZip(zipPath, extractTo) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractTo }))
      .on('close', resolve)
      .on('error', reject);
  });
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
  console.time(`[⏱️] ${AI_NAME}: Total Training Time`);
  ensureDir(MODEL_DIR);

  if (fs.existsSync(ZIP_PATH)) {
    console.log(`[📦] ${AI_NAME}: Loading existing ZIP model from Drive...`);
    await extractZip(ZIP_PATH, MODEL_DIR);
  } else {
    console.log(`[⚠️] ${AI_NAME}: No existing ZIP found — fresh start.`);
  }

  const echoBuffers = await getTrainingChunks();
  console.log(`[🧠] ${AI_NAME}: Prepared ${echoBuffers.length} echo chunks`);

  const baseModel = buildModel();
  await loadSparseWeights(baseModel, 'hunter');

  console.log(`[🔥] ${AI_NAME}: Training on new data...`);
  const trainedModel = await trainShadowModel(echoBuffers);

  console.log(`[🔬] ${AI_NAME}: Calculating sparse deltas...`);
  const deltas = await getSparseWeights(baseModel, trainedModel);

  const sparsePath = path.join(MODEL_DIR, 'weights_sparse_latest.bin');
  const compressed = zlib.gzipSync(JSON.stringify(deltas));
  fs.writeFileSync(sparsePath, compressed);
  console.log(`[💾] ${AI_NAME}: Sparse weights saved`);

  await zipModelDir(MODEL_DIR, ZIP_PATH);
  console.log(`[☁️] ${AI_NAME}: Updated ZIP saved to Drive`);

  console.timeEnd(`[⏱️] ${AI_NAME}: Total Training Time`);
  console.log(`[✅] ${AI_NAME}: Incremental training complete`);
}

main().catch(e => console.error(`[❌] ${AI_NAME}: Training Error:`, e));
