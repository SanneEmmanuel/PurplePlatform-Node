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

// Market Regime Classification
export function classifyMarket(ticks) {
  const prices = ticks.map(t => t.quote);
  const diff = prices.slice(1).map((p, i) => p - prices[i]);
  const mean = diff.reduce((a, b) => a + b, 0) / diff.length;
  const volatility = Math.sqrt(diff.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / diff.length);
  return volatility > 1.5 ? 'volatile' : Math.abs(mean) > 0.5 ? 'trending' : 'ranging';
}

// Core Model Definition
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

// Custom ReduceLROnPlateau Callback (TF.js doesn’t have this)
function ReduceLROnPlateau({ monitor = 'loss', factor = 0.5, patience = 3, minLR = 1e-6 } = {}) {
  let wait = 0;
  let best = Infinity;

  return {
    async onEpochEnd(epoch, logs) {
      const current = logs[monitor];
      if (current < best) {
        best = current;
        wait = 0;
      } else {
        wait++;
        if (wait >= patience) {
          const optimizer = this.model.optimizer;
          const currentLR = await optimizer.getLearningRate();
          const newLR = Math.max(currentLR * factor, minLR);
          await optimizer.setLearningRate(newLR);
          console.log(`[📉] Reduced learning rate to ${newLR}`);
          wait = 0;
        }
      }
    }
  };
}

// Model Training with Echo Buffers
export async function trainShadowModel(echoBuffers) {
  const inputs = [];
  const scaledLabels = [];

  for (const buffer of echoBuffers) {
    const echo = JSON.parse(zlib.gunzipSync(buffer));

    // Extract OHLC features
    const features = echo.ticks.map(t => [t.open, t.high, t.low, t.close]);

    // Compute close prices and regime importance
    const closes = echo.ticks.map(t => t.close);
    const regime = classifyMarket(echo.ticks);
    const importance = regime === 'volatile' ? 1.5 : 1.0;

    // Apply importance weight by scaling label values
    const weightedCloses = closes.map(c => c * importance);

    // Accumulate
    inputs.push(...features);
    scaledLabels.push(...weightedCloses);
  }

  // Create tensors
  const inputTensor = tf.tensor2d(inputs);
  const labelTensor = tf.tensor1d(scaledLabels);

  // Add training noise for regularization
  const noise = tf.randomNormal(inputTensor.shape, 0, 0.01);
  const noisyInputs = inputTensor.add(noise);

  // Build fresh model
  const model = buildModel();

  // Callbacks
  const earlyStopping = tf.callbacks.earlyStopping({ monitor: 'loss', patience: 3 });
  const lrScheduler = ReduceLROnPlateau({ monitor: 'loss', factor: 0.5, patience: 2 });

  // Train
  await model.fit(noisyInputs, labelTensor, {
    epochs: 100,
    batchSize: 32,
    callbacks: [earlyStopping, lrScheduler],
    verbose: 0
  });

  return model;
}


// Sparse Delta Weight Extraction
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
  }

  return deltas;
}

// Load Sparse Deltas into Model
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

// Load Sparse Weights from ZIP
export async function loadSparseWeightsFromZip(model, zipPath, type = 'hunter') {
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
}

// Short-Term Volatility Estimator
export function flashUrgency(ticks) {
  const prices = ticks.map(t => t.quote);
  const vol = Math.sqrt(prices.map((v, i) => i > 0 ? (v - prices[i - 1]) ** 2 : 0).reduce((a, b) => a + b, 0) / prices.length);
  const momentum = prices.at(-1) - prices[0];
  const rawConfidence = Math.min(1, Math.abs(momentum) * 5);
  const confidence = rawConfidence * (vol > 0.3 ? 1 : 0.8);
  return Math.abs(momentum) > 0.2 && vol > 0.3
    ? { urgency: 'NOW', confidence }
    : { urgency: 'WAIT', confidence: 1 - vol };
}

// Core Market Direction via Model Consensus
export async function coreDirection(ticks) {
  const input = tf.tensor2d(ticks.map(t => [t.open, t.high, t.low, t.close]));
  const models = [buildModel(), buildModel(), buildModel()];
  for (const model of models) await loadSparseWeights(model, 'hunter');
  const predictions = await Promise.all(models.map(m => m.predict(input).array()));
  const lastPredictions = predictions.map(p => p.at(-1)[0]);
  const avgPrediction = lastPredictions.reduce((a, b) => a + b, 0) / lastPredictions.length;
  const lastClose = ticks.at(-1).close;
  const direction = avgPrediction > lastClose ? 1 : -1;
  const tp = direction > 0 ? lastClose * 1.005 : lastClose * 0.995;
  return { direction, tp, predicted: avgPrediction };
}

// Final Decision from Core + Flash
export function reflexDecision(core, flash) {
  const size = Math.min(1, flash.confidence * 0.8);
  const sl = core.direction > 0 ? core.tp * 0.996 : core.tp * 1.004;
  return {
    direction: core.direction,
    size: +size.toFixed(2),
    tp: +core.tp.toFixed(3),
    sl: +sl.toFixed(3),
    confidence: +flash.confidence.toFixed(2)
  };
}

// Full AI Prediction Cycle
export async function runPrediction(ticks) {
  if (ticks.length < 300) throw new Error('Insufficient tick history');
  const flash = flashUrgency(ticks.slice(-50));
  if (flash.urgency !== 'NOW') return { action: 'WAIT', flash };
  const core = await coreDirection(ticks.slice(-300));
  const reflex = reflexDecision(core, flash);
  return { action: 'TRADE', flash, core, reflex };
}

// Export ZIP with Sparse Weights and Metadata
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
