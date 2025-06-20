// engine/libra.js
const tf = require('@tensorflow/tfjs-node');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs').promises;

const { initializeApp } = require('firebase/app');
const { getStorage, ref: storageRef, uploadBytes } = require('firebase/storage');
const { getDatabase, ref: dbRef, set } = require('firebase/database');

// --- 🔧 Firebase Configuration ---
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  databaseURL: process.env.FIREBASE_DB_URL
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const db = getDatabase(app);

// --- 📊 1. Market Regime Classifier ---
function classifyMarket(ticks) {
  const prices = ticks.map(t => t.quote);
  const diff = prices.slice(1).map((p, i) => p - prices[i]);
  const mean = diff.reduce((a, b) => a + b, 0) / diff.length;
  const volatility = Math.sqrt(diff.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / diff.length);

  if (volatility > 1.5) return 'volatile';
  if (Math.abs(mean) > 0.5) return 'trending';
  return 'ranging';
}

// --- 🧠 2. Shadow Model Trainer ---
async function trainShadowModel(echoes) {
  const inputs = [], labels = [];

  for (const echo of echoes) {
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

  console.log('[✅] Shadow training complete.');
  return model;
}

// --- 🧪 3. Sparse Weight Extractor ---
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

// --- 🧾 4. Save Sparse Model to Firebase ---
async function saveSparseModel(deltas, modelName = 'shadow') {
  const payload = JSON.stringify(deltas);
  const compressed = zlib.gzipSync(payload);
  const filename = `models/${modelName}/weights_sparse_${Date.now()}.bin`;

  const fileRef = storageRef(storage, filename);
  await uploadBytes(fileRef, compressed);

  console.log(`[💾] Sparse model uploaded as: ${filename}`);
}

// --- 🔐 5. Echo Sequence Recorder ---
async function storeEcho(ticks, regime, outcome) {
  const compressed = zlib.gzipSync(JSON.stringify({ ticks, outcome }));
  const filePath = `echoes/${regime}/${Date.now()}.bin`;

  const fileRef = storageRef(storage, filePath);
  await uploadBytes(fileRef, compressed);

  await set(dbRef(db, `echoes_meta/${Date.now()}`), {
    regime, outcome, count: ticks.length
  });

  console.log(`[🧬] Echo stored under ${regime} → ${filePath}`);
}

// --- 🌐 Exports ---
module.exports = {
  classifyMarket,
  trainShadowModel,
  getSparseWeights,
  saveSparseModel,
  storeEcho
};
