// libra.js - Advanced AI Core (TensorFlow.js Compatible Version)
// Author: Dr. Sanne Karibo - PurpleBot AI (Efficient, Sparse Training)

import { readFileSync, existsSync, createWriteStream } from 'fs';
import * as tf from '@tensorflow/tfjs-node';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, access, writeFile, mkdir } from 'fs/promises';
import archiver from 'archiver';
import unzipper from 'unzipper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelsCache = {};
export let lastAnalysisResult = null;

const BASE_PATH = '/tmp/model/hunter';
const ZIP_PATH = path.join(__dirname, 'model/hunter.zip');

const preloadedModelPromise = (async () => {
  if (existsSync(ZIP_PATH)) {
    console.log('[📦] Found ZIP file with weights. Loading before anything else...');
    const model = buildModel();
    await extractZip(ZIP_PATH, BASE_PATH);
    console.log('[📂] Unzipped model into /tmp');
    await loadSparseWeights(model, 'hunter');
    console.log('[✅] Successfully loaded sparse weights into model');
    modelsCache.hunter = model;
  } else {
    console.log('[ℹ️] No ZIP file found. Skipping preload.');
  }
})();

export function classifyMarket(ticks) {
  const prices = ticks.map(t => t.quote);
  const diff = prices.slice(1).map((p, i) => p - prices[i]);
  const mean = diff.reduce((a, b) => a + b, 0) / diff.length;
  const volatility = Math.sqrt(diff.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / diff.length);
  return volatility > 1.5 ? 'volatile' : Math.abs(mean) > 0.5 ? 'trending' : 'ranging';
}

export function buildModel() {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [4] }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dropout({ rate: 0.3 }));
  model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: tf.train.adam(), loss: 'meanSquaredError' });
  return model;
}

export async function trainShadowModel(echoBuffers) {
  const inputs = [];
  const scaledLabels = [];

  for (const buffer of echoBuffers) {
    try {
      const echo = JSON.parse(zlib.gunzipSync(buffer));
      if (!echo?.ticks?.length) continue;
      const features = echo.ticks.map(t => [t.open, t.high, t.low, t.close]);
      const closes = echo.ticks.map(t => t.close);
      const regime = classifyMarket(echo.ticks);
      const importance = regime === 'volatile' ? 1.5 : 1.0;
      const weightedCloses = closes.map(c => c * importance);
      inputs.push(...features);
      scaledLabels.push(...weightedCloses);
    } catch (err) {
      console.warn('[⚠️] Skipped malformed echo buffer:', err.message);
    }
  }

  const inputTensor = tf.tensor2d(inputs);
  const labelTensor = tf.tensor1d(scaledLabels);
  const noise = tf.randomNormal(inputTensor.shape, 0, 0.01);
  const noisyInputs = inputTensor.add(noise);

  const model = buildModel();

  const earlyStopping = tf.callbacks.earlyStopping({
    monitor: 'loss',
    patience: 3,
    restoreBestWeight: true
  });

  await model.fit(noisyInputs, labelTensor, {
    epochs: 100,
    batchSize: 32,
    callbacks: [earlyStopping],
    verbose: 0
  });

  inputTensor.dispose();
  labelTensor.dispose();
  noise.dispose();
  noisyInputs.dispose();

  return model;
}

export async function getSparseWeights(baseModel, trainedModel) {
  const base = baseModel.getWeights();
  const updated = trainedModel.getWeights();
  const deltas = [];

  for (let i = 0; i < updated.length; i++) {
    const delta = tf.sub(updated[i], base[i]);
    const abs = tf.abs(delta);
    const mean = tf.mean(abs).arraySync();
    const threshold = mean * 2;
    const mask = tf.greater(abs, threshold);
    const sparse = tf.mul(tf.cast(mask, 'float32'), delta);
    deltas.push({ id: i, shape: sparse.shape, data: await sparse.array() });
    delta.dispose(); abs.dispose(); mask.dispose(); sparse.dispose();
  }

  return deltas;
}

export async function loadSparseWeights(model, type = 'hunter') {
  const filePath = path.join(BASE_PATH, 'weights_sparse_latest.bin');
  try {
    await access(filePath);
    const compressed = await readFile(filePath);
    const deltaData = JSON.parse(zlib.gunzipSync(compressed).toString());
    const weights = model.getWeights();
    const updated = weights.map((w, i) => {
      const delta = deltaData.find(d => d.id === i);
      return delta ? tf.add(w, tf.tensor(delta.data, delta.shape)) : w;
    });
    model.setWeights(updated);
    console.log(`[🧠] Sanne-junior: Weights for '${type}' applied`);
  } catch {
    console.warn(`[⚠️] Sanne-junior: No sparse weights found for '${type}'`);
  }
}

export async function extractZip(zipPath, extractTo) {
  const dir = await unzipper.Open.file(zipPath);
  await mkdir(extractTo, { recursive: true });
  await Promise.all(dir.files.map(file =>
    file.stream().pipe(createWriteStream(path.join(extractTo, file.path)))
  ));
}

export async function loadSparseWeightsFromZip(model, zipPath, type = 'hunter') {
  try {
    await extractZip(zipPath, BASE_PATH);
    await loadSparseWeights(model, type);
  } catch (err) {
    console.error(`[❌] Sanne-junior: Failed to load weights from ZIP: ${err.message}`);
  }
}

// The rest of the functions (flashUrgency, coreDirection, reflexDecision, runPrediction, exportTrainingResult)
// remain unchanged — only the directory logic was updated.

export const ready = preloadedModelPromise;
