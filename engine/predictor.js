// engine/predictor.js
/**
 * PREDICTOR.JS
 * ------------------------------------------------
 * Tiered Inference System:
 *  - Flash  → Immediate urgency (50 ticks)
 *  - Core   → Market prediction (300 ticks)
 *  - Reflex → Converts to trade actions
 * 
 * Uses Hunter model (loaded from sparse weights)
 * -----------------------------------------------
 */

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');

// --- ⚡ Tier 1: Flash Predictor (Urgency) ---
async function flashUrgency(ticks) {
  const prices = ticks.map(t => t.quote);
  const vol = Math.sqrt(prices.map((v, i) => (i > 0 ? (v - prices[i - 1]) ** 2 : 0)).reduce((a, b) => a + b, 0) / prices.length);
  const momentum = prices[prices.length - 1] - prices[0];

  const threshold = 0.2;
  if (Math.abs(momentum) > threshold && vol > 0.3) {
    return { urgency: 'NOW', confidence: Math.min(1, Math.abs(momentum) * 5) };
  }
  return { urgency: 'WAIT', confidence: Math.max(0, 1 - vol) };
}

// --- 🧠 Tier 2: Core Predictor (Direction, TP) ---
async function coreDirection(ticks) {
  const input = ticks.map(t => [t.open, t.high, t.low, t.close]);
  const inputTensor = tf.tensor2d(input);

  const model = buildModel();
  await loadSparseWeights(model, 'hunter'); // load from Firebase or local if emulated

  const output = model.predict(inputTensor);
  const predClose = output.arraySync().pop(); // use last prediction

  const lastClose = ticks[ticks.length - 1].close;
  const direction = predClose > lastClose ? 1 : -1;
  const tp = direction > 0 ? lastClose * 1.005 : lastClose * 0.995;

  return { direction, tp, predicted: predClose };
}

// --- 🧬 Tier 3: Reflex Planner (Trade Size + Execution) ---
function reflexDecision(core, flash) {
  const { direction, tp } = core;
  const { confidence } = flash;

  const size = Math.min(1, confidence * 0.8);
  const sl = direction > 0 ? tp - (tp - tp * 0.996) : tp + (tp * 0.996 - tp);

  return {
    direction,
    size: Number(size.toFixed(2)),
    tp: Number(tp.toFixed(3)),
    sl: Number(sl.toFixed(3)),
    confidence: Number(confidence.toFixed(2))
  };
}

// --- 🧩 Sparse Weight Loader ---
async function loadSparseWeights(model, type = 'hunter') {
  const filePath = path.join(__dirname, `model/${type}/weights_sparse_latest.bin`);
  const exists = await fs.stat(filePath).catch(() => false);
  if (!exists) {
    console.warn(`[⚠️] Sparse weights not found for ${type}.`);
    return;
  }

  const compressed = await fs.readFile(filePath);
  const deltaData = JSON.parse(zlib.gunzipSync(compressed).toString());

  const currentWeights = model.getWeights();
  const newWeights = currentWeights.map((w, i) => {
    const delta = deltaData.find(d => d.id === i);
    if (!delta) return w;

    const deltaTensor = tf.tensor(delta.data, delta.shape);
    return tf.add(w, deltaTensor);
  });

  model.setWeights(newWeights);
}

// --- 🔧 Base Model Builder (matches Shadow/Hunter) ---
function buildModel() {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [4] }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
  return model;
}

// --- 🌐 Combined Interface ---
async function runPrediction(ticks) {
  if (ticks.length < 300) throw new Error('Insufficient tick history');

  const flashTicks = ticks.slice(-50);
  const coreTicks = ticks.slice(-300);

  const flash = await flashUrgency(flashTicks);
  if (flash.urgency !== 'NOW') return { action: 'WAIT', reason: 'Low urgency', flash };

  const core = await coreDirection(coreTicks);
  const reflex = reflexDecision(core, flash);

  return {
    action: 'TRADE',
    flash,
    core,
    reflex
  };
}

module.exports = {
  runPrediction,
  flashUrgency,
  coreDirection,
  reflexDecision
};
