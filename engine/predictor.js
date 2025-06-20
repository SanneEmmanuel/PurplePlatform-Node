// engine/predictor.js
// 🔹 PurpleBot Prediction Pipeline: Flash → Core → Reflex

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');

// Flash Urgency Predictor
async function flashUrgency(ticks) {
  const prices = ticks.map(t => t.quote);
  const vol = Math.sqrt(prices.map((v, i) => i > 0 ? (v - prices[i - 1]) ** 2 : 0).reduce((a, b) => a + b, 0) / prices.length);
  const momentum = prices[prices.length - 1] - prices[0];

  if (Math.abs(momentum) > 0.2 && vol > 0.3) {
    return { urgency: 'NOW', confidence: Math.min(1, Math.abs(momentum) * 5) };
  }
  return { urgency: 'WAIT', confidence: 1 - vol };
}

// Core Predictor
async function coreDirection(ticks) {
  const input = ticks.map(t => [t.open, t.high, t.low, t.close]);
  const model = buildModel();
  await loadSparseWeights(model, 'hunter');

  const output = model.predict(tf.tensor2d(input));
  const predClose = output.arraySync().pop();
  const lastClose = ticks[ticks.length - 1].close;
  const direction = predClose > lastClose ? 1 : -1;
  const tp = direction > 0 ? lastClose * 1.005 : lastClose * 0.995;

  return { direction, tp, predicted: predClose };
}

// Reflex Layer
function reflexDecision(core, flash) {
  const size = Math.min(1, flash.confidence * 0.8);
  const sl = core.direction > 0 ? core.tp * 0.996 : core.tp * 1.004;
  return {
    direction: core.direction,
    size: Number(size.toFixed(2)),
    tp: Number(core.tp.toFixed(3)),
    sl: Number(sl.toFixed(3)),
    confidence: Number(flash.confidence.toFixed(2))
  };
}

// Load Sparse Weights
async function loadSparseWeights(model, type = 'hunter') {
  const filePath = path.join(__dirname, `model/${type}/weights_sparse_latest.bin`);
  const exists = await fs.stat(filePath).catch(() => false);
  if (!exists) {
    console.warn(`[⚠️] Sparse weights not found for ${type}.`);
    return;
  }
  const compressed = await fs.readFile(filePath);
  const deltaData = JSON.parse(zlib.gunzipSync(compressed).toString());

  const current = model.getWeights();
  model.setWeights(current.map((w, i) => {
    const delta = deltaData.find(d => d.id === i);
    return delta ? tf.add(w, tf.tensor(delta.data, delta.shape)) : w;
  }));
}

// Build Base Model
function buildModel() {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [4] }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
  return model;
}

// Unified Prediction Call
async function runPrediction(ticks) {
  if (ticks.length < 300) throw new Error('Need 300 ticks minimum');
  const flash = await flashUrgency(ticks.slice(-50));
  if (flash.urgency !== 'NOW') return { action: 'WAIT', flash };

  const core = await coreDirection(ticks.slice(-300));
  const reflex = reflexDecision(core, flash);

  return { action: 'TRADE', flash, core, reflex };
}

module.exports = { runPrediction, flashUrgency, coreDirection, reflexDecision };
