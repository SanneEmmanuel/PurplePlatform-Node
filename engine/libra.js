// engine/libra.js
// 🔹 PurpleBot AI Core: Echo Storage, Regime Detection, Shadow Training

const tf = require('@tensorflow/tfjs-node');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs').promises;

const { storage, db } = require('../fb');
const { ref: dbRef, set } = require('firebase/database');
const { ref: storageRef, uploadBytes } = require('firebase/storage');

// 📊 Market Regime Classifier
function classifyMarket(ticks) {
  const prices = ticks.map(t => t.quote);
  const diff = prices.slice(1).map((p, i) => p - prices[i]);
  const mean = diff.reduce((a, b) => a + b, 0) / diff.length;
  const volatility = Math.sqrt(diff.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / diff.length);

  if (volatility > 1.5) return 'volatile';
  if (Math.abs(mean) > 0.5) return 'trending';
  return 'ranging';
}

// 💾 Echo Sequence Storage
async function storeEcho(ticks, regime, outcome) {
  const compressed = zlib.gzipSync(JSON.stringify({ ticks, outcome }));
  const filePath = `echoes/${regime}/${Date.now()}.bin`;

  const fileRef = storageRef(storage, filePath);
  await uploadBytes(fileRef, compressed);

  await set(dbRef(db, `echoes_meta/${Date.now()}`), {
    regime, outcome, count: ticks.length
  });

  console.log(`[🧬] Echo stored → ${filePath}`);
}

// 🧠 Shadow Model Trainer
async function trainShadowModel(echoBuffers) {
  const inputs = [], labels = [];

  for (const echo of echoBuffers) {
    const parsed = JSON.parse(zlib.gunzipSync(echo));
    const ticks = parsed.ticks;
    const features = ticks.map(t => [t.open, t.high, t.low, t.close]);
    const closes = ticks.map(t => t.close);

    inputs.push(...features);
    labels.push(...closes);
  }

  const inputTensor = tf.tensor2d(inputs);
  const labelTensor = tf.tensor1d(labels);

  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [4] }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

  console.log('[🧠] Training Shadow model...');
  await model.fit(inputTensor, labelTensor, { epochs: 20, batchSize: 32, verbose: 0 });

  return model;
}

// 🧪 Sparse Weight Extractor
async function getSparseWeights(baseModel, trainedModel) {
  const baseWeights = baseModel.getWeights();
  const newWeights = trainedModel.getWeights();

  const deltas = [];

  for (let i = 0; i < newWeights.length; i++) {
    const oldTensor = baseWeights[i];
    const newTensor = newWeights[i];

    const delta = tf.abs(tf.sub(newTensor, oldTensor));
    const mean = tf.mean(delta).arraySync();
    const threshold = mean * 2;

    const mask = tf.greater(delta, threshold);
    const sparseDelta = tf.mul(tf.cast(mask, 'float32'), tf.sub(newTensor, oldTensor));

    deltas.push({ id: i, shape: sparseDelta.shape, data: await sparseDelta.array() });
  }

  return deltas;
}

// 🧾 Upload Sparse Weights
async function saveSparseModel(deltas, modelName = 'shadow') {
  const payload = JSON.stringify(deltas);
  const compressed = zlib.gzipSync(payload);
  const filename = `models/${modelName}/weights_sparse_latest.bin`;

  const fileRef = storageRef(storage, filename);
  await uploadBytes(fileRef, compressed);

  console.log(`[💾] Saved ${modelName} model to Firebase`);
}

module.exports = {
  classifyMarket,
  storeEcho,
  trainShadowModel,
  getSparseWeights,
  saveSparseModel
};
