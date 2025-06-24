// HistoryTrain.js – Incremental AI Training from ZIP (Colab Compatible)
// Author: Dr. Sanne Karibo – PurpleBot AI Core ("Sanne-junior")

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

const ZIP_PATH = '/content/drive/MyDrive/libra_model.zip';  // 👈 From Colab
const TMP_MODEL_DIR = '/tmp/model/hunter';
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
  const days = parseInt(process.argv[2]) || 1;
  const all = await getTicksForTraining(total * days);
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
      .on('close', () => {
        console.log(`[📦] Sanne-junior: Unzipped previous model to ${extractTo}`);
        resolve();
      })
      .on('error', reject);
  });
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[📁] Sanne-junior: Created directory -> ${dirPath}`);
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
  console.time('[⏱️] Sanne-junior: Total Training Time');
  ensureDir(TMP_MODEL_DIR);

  if (fs.existsSync(ZIP_PATH)) {
    console.log('[📦] Sanne-junior: Loading existing ZIP model from Drive...');
    await extractZip(ZIP_PATH, TMP_MODEL_DIR);
  } else {
    console.log('[⚠️] Sanne-junior: No ZIP found — starting from scratch');
  }

  const echoBuffers = await getTrainingChunks();
  console.log(`[🧠] Sanne-junior: Prepared ${echoBuffers.length} echo chunks`);

  const baseModel = buildModel();
  await loadSparseWeights(baseModel, 'hunter');

  console.log('[🔥] Sanne-junior: Training on new data...');
  const trainedModel = await trainShadowModel(echoBuffers);

  console.log('[🔬] Sanne-junior: Calculating sparse deltas...');
  const deltas = await getSparseWeights(baseModel, trainedModel);

  const weightsPath = path.join(TMP_MODEL_DIR, 'weights_sparse_latest.bin');
  const compressed = zlib.gzipSync(JSON.stringify(deltas));
  fs.writeFileSync(weightsPath, compressed);
  console.log('[💾] Sanne-junior: Saved new sparse weights to /tmp');

  await zipModelDir(TMP_MODEL_DIR, ZIP_PATH);
  console.log('[☁️] Sanne-junior: Updated ZIP model saved to Drive');

  console.timeEnd('[⏱️] Sanne-junior: Total Training Time');
  console.log('[✅] Sanne-junior: Training completed successfully');
}

main().catch(err => {
  console.error('[❌] Sanne-junior: Training failed:', err);
});
