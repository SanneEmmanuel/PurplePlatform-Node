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

const TP_MULTIPLIER = 0.005;
const SL_MULTIPLIER = 0.004;
const MOMENTUM_THRESHOLD = 0.2;
const VOLATILITY_THRESHOLD = 0.3;

const preloadedModelPromise = (async () => {
  const zipPath = path.join(__dirname, 'model/hunter.zip');
  if (existsSync(zipPath)) {
    console.log('[📦] Found ZIP file with weights. Loading before anything else...');
    const model = buildModel();
    await loadSparseWeightsFromZip(model, zipPath, 'hunter');
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
    delta.dispose(); abs.dispose(); mean && tf.scalar(mean).dispose(); mask.dispose(); sparse.dispose();
  }

  return deltas;
}

export async function loadSparseWeights(model, type = 'hunter') {
  const filePath = path.join(__dirname, `model/${type}/weights_sparse_latest.bin`);
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
  } catch {
    console.warn(`[⚠️] No sparse weights found for '${type}'`);
  }
}

export async function loadSparseWeightsFromZip(model, zipPath, type = 'hunter') {
  try {
    const directory = await unzipper.Open.file(zipPath);
    const weightsEntry = directory.files.find(f => f.path === 'weights_sparse_latest.bin');
    if (!weightsEntry) throw new Error('Weights not found in zip.');
    const content = await weightsEntry.buffer();
    const deltaData = JSON.parse(zlib.gunzipSync(content).toString());
    const weights = model.getWeights();
    const updated = weights.map((w, i) => {
      const delta = deltaData.find(d => d.id === i);
      return delta ? tf.add(w, tf.tensor(delta.data, delta.shape)) : w;
    });
    model.setWeights(updated);
  } catch (err) {
    console.error(`[❌] Failed to load weights from ZIP: ${err.message}`);
  }
}

export function flashUrgency(ticks) {
  const prices = ticks.map(t => t.quote);
  const vol = Math.sqrt(prices.map((v, i) => i > 0 ? (v - prices[i - 1]) ** 2 : 0).reduce((a, b) => a + b, 0) / prices.length);
  const momentum = prices.at(-1) - prices[0];
  const rawConfidence = Math.min(1, Math.abs(momentum) * 5);
  const confidence = rawConfidence * (vol > VOLATILITY_THRESHOLD ? 1 : 0.8);
  return Math.abs(momentum) > MOMENTUM_THRESHOLD && vol > VOLATILITY_THRESHOLD
    ? { urgency: 'NOW', confidence }
    : { urgency: 'WAIT', confidence: 1 - vol };
}

export async function coreDirection(ticks) {
  await preloadedModelPromise;
  const input = tf.tensor2d(ticks.map(t => [t.open, t.high, t.low, t.close]));
  const baseModel = modelsCache.hunter || buildModel();
  const models = [baseModel, buildModel(), buildModel()];
  for (let i = 1; i < models.length; i++) {
    await loadSparseWeights(models[i], 'hunter');
  }
  const predictions = await Promise.all(models.map(m => m.predict(input).array()));
  input.dispose();
  const lastPredictions = predictions.map(p => p.at(-1)[0]);
  const avgPrediction = lastPredictions.reduce((a, b) => a + b, 0) / lastPredictions.length;
  const lastClose = ticks.at(-1).close;
  const direction = avgPrediction > lastClose ? 1 : -1;
  const tp = direction > 0 ? lastClose * (1 + TP_MULTIPLIER) : lastClose * (1 - TP_MULTIPLIER);
  return { direction, tp, predicted: avgPrediction, lastClose, lastPredictions };
}

export function reflexDecision(core, flash) {
  const size = Math.min(1, flash.confidence * 0.8);
  const sl = core.direction > 0 ? core.tp * (1 - SL_MULTIPLIER) : core.tp * (1 + SL_MULTIPLIER);
  return {
    direction: core.direction,
    size: +size.toFixed(2),
    tp: +core.tp.toFixed(3),
    sl: +sl.toFixed(3),
    confidence: +flash.confidence.toFixed(2)
  };
}

export async function runPrediction(ticks) {
  if (ticks.length < 300) throw new Error('Insufficient tick history');
  const flash = flashUrgency(ticks.slice(-50));
  if (flash.urgency !== 'NOW') {
    lastAnalysisResult = { action: 'WAIT', flash };
    return lastAnalysisResult;
  }
  const core = await coreDirection(ticks.slice(-300));
  const reflex = reflexDecision(core, flash);
  lastAnalysisResult = { action: 'TRADE', flash, core, reflex };
  return lastAnalysisResult;
}

export async function exportTrainingResult(model, type = 'hunter') {
  const baseModel = buildModel();
  const sparseWeights = await getSparseWeights(baseModel, model);
  const exportDir = path.join(__dirname, 'export', type);
  const weightsPath = path.join(exportDir, 'weights_sparse_latest.bin');
  const metadataPath = path.join(exportDir, 'meta.json');
  await mkdir(exportDir, { recursive: true });
  const compressed = zlib.gzipSync(JSON.stringify(sparseWeights));
  await writeFile(weightsPath, compressed);
  const metadata = {
    model: type,
    date: new Date().toISOString(),
    totalLayers: sparseWeights.length,
    sizeKB: Math.ceil(compressed.length / 1024)
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  const zipName = `/tmp/libra_export_${Date.now()}.zip`;
  const output = createWriteStream(zipName);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(output);
  archive.file(weightsPath, { name: 'weights_sparse_latest.bin' });
  archive.file(metadataPath, { name: 'meta.json' });
  await archive.finalize();
  return zipName;
}

export const ready = preloadedModelPromise;
