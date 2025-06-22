// libra.js - PurpleBot AI Core (Admin SDK + Genius Enhancements)
// Author: Dr. Sanne Karibo

// 🔗 Dependencies (ESM + Admin SDK)
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import serviceAccount from './serviceAccountKey.json' assert { type: 'json' };

import * as tf from '@tensorflow/tfjs-node';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, access } from 'fs/promises';

// 🔁 __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔐 Firebase Admin Initialization
initializeApp({
  credential: cert(serviceAccount),
  storageBucket: 'libra-e615f.appspot.com'
});

const db = getFirestore();
const storage = getStorage();
const bucket = storage.bucket();

// ========================
// 📊 Genius Market Classifier
// ========================
export function classifyMarket(ticks) {
  const prices = ticks.map(t => t.quote);
  const diff = prices.slice(1).map((p, i) => p - prices[i]);
  const mean = diff.reduce((a, b) => a + b, 0) / diff.length;
  const volatility = Math.sqrt(diff.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / diff.length);

  return volatility > 1.5 ? 'volatile' : Math.abs(mean) > 0.5 ? 'trending' : 'ranging';
}

// ========================
// 🧠 Model + Genius Layers
// ========================
export function buildModel() {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [4] }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
  return model;
}

export async function trainShadowModel(echoBuffers) {
  let inputs = [], labels = [];

  for (const buffer of echoBuffers) {
    const echo = JSON.parse(zlib.gunzipSync(buffer));
    const features = echo.ticks.map(t => [t.open, t.high, t.low, t.close]);
    const closes = echo.ticks.map(t => t.close);
    inputs.push(...features);
    labels.push(...closes);
  }

  const inputTensor = tf.tensor2d(inputs);
  const labelTensor = tf.tensor1d(labels);
  const model = buildModel();
  await model.fit(inputTensor, labelTensor, { epochs: 25, batchSize: 32, verbose: 0 });
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
  }

  return deltas;
}

// ========================
// 🔮 Prediction Logic
// ========================
export function flashUrgency(ticks) {
  const prices = ticks.map(t => t.quote);
  const vol = Math.sqrt(prices.map((v, i) => i > 0 ? Math.pow(v - prices[i - 1], 2) : 0).reduce((a, b) => a + b, 0) / prices.length);
  const momentum = prices.at(-1) - prices[0];

  return Math.abs(momentum) > 0.2 && vol > 0.3
    ? { urgency: 'NOW', confidence: Math.min(1, Math.abs(momentum) * 5) }
    : { urgency: 'WAIT', confidence: 1 - vol };
}

export async function loadSparseWeights(model, type = 'hunter') {
  const filePath = path.join(__dirname, `model/${type}/weights_sparse_latest.bin`);
  try {
    await access(filePath);
    const compressed = await readFile(filePath);
    const deltaData = JSON.parse(zlib.gunzipSync(compressed).toString());
    const weights = model.getWeights();

    const updatedWeights = weights.map((w, i) => {
      const delta = deltaData.find(d => d.id === i);
      return delta ? tf.add(w, tf.tensor(delta.data, delta.shape)) : w;
    });

    model.setWeights(updatedWeights);
  } catch (err) {
    console.warn(`[⚠️] No sparse weights found for '${type}'`);
  }
}

export async function coreDirection(ticks) {
  const input = ticks.map(t => [t.open, t.high, t.low, t.close]);
  const model = buildModel();
  await loadSparseWeights(model, 'hunter');

  const prediction = model.predict(tf.tensor2d(input));
  const predClose = prediction.arraySync().pop();
  const lastClose = ticks.at(-1).close;
  const direction = predClose > lastClose ? 1 : -1;
  const tp = direction > 0 ? lastClose * 1.005 : lastClose * 0.995;

  return { direction, tp, predicted: predClose };
}

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

export async function runPrediction(ticks) {
  if (ticks.length < 300) throw new Error('Insufficient tick history');
  const flash = flashUrgency(ticks.slice(-50));
  if (flash.urgency !== 'NOW') return { action: 'WAIT', flash };

  const core = await coreDirection(ticks.slice(-300));
  const reflex = reflexDecision(core, flash);

  return { action: 'TRADE', flash, core, reflex };
}

// ========================
// 📦 Exports
// ========================
export {
  db,
  bucket
};
