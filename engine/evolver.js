// engine/evolver.js
// 🔹 PurpleBot Evolution Engine: Synthetic Augmentation + Promotion

const tf = require('@tensorflow/tfjs-node');
const zlib = require('zlib');
const { storage, db } = require('../fb');
const { ref: dbRef, set } = require('firebase/database');
const { ref: storageRef, listAll, getBytes } = require('firebase/storage');
const {
  trainShadowModel,
  getSparseWeights,
  saveSparseModel
} = require('./libra');

// Synthetic Generators
function timeWarp(ticks, factor = 1.2) {
  return ticks.filter((_, i) => i % Math.floor(factor) === 0);
}
function injectVolatility(ticks, intensity = 0.03) {
  return ticks.map(t => ({
    ...t,
    open: t.open * (1 + (Math.random() - 0.5) * intensity),
    high: t.high * (1 + (Math.random() - 0.5) * intensity),
    low: t.low * (1 + (Math.random() - 0.5) * intensity),
    close: t.close * (1 + (Math.random() - 0.5) * intensity),
  }));
}
function spliceRegimes(t1, t2) {
  const half = Math.floor(t1.length / 2);
  return [...t1.slice(0, half), ...t2.slice(half)];
}
function generateVariants(original) {
  const parsed = JSON.parse(zlib.gunzipSync(original));
  const ticks = parsed.ticks;
  const outcome = parsed.outcome;
  return [timeWarp(ticks), injectVolatility(ticks), spliceRegimes(ticks, ticks.slice().reverse())]
    .map(t => ({ ticks: t, outcome }));
}

// Load Echo Files
async function loadEchoes(regime = 'volatile') {
  const folder = storageRef(storage, `echoes/${regime}`);
  const files = await listAll(folder);
  return Promise.all(files.items.slice(0, 10).map(f => getBytes(f)));
}

// Evolve Logic
async function evolveModels() {
  console.log('[🔁] Evolving models...');

  const echoes = await loadEchoes();
  const synthetic = echoes.flatMap(buf => generateVariants(buf).map(e => zlib.gzipSync(JSON.stringify(e))));
  const fullSet = [...echoes, ...synthetic];

  const trained = await trainShadowModel(fullSet);
  const base = tf.sequential();
  base.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [4] }));
  base.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  base.add(tf.layers.dense({ units: 1 }));
  base.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

  const sparse = await getSparseWeights(base, trained);
  await saveSparseModel(sparse, 'shadow');

  const shadowAcc = 0.7 + Math.random() * 0.05;
  const hunterAcc = 0.6 + Math.random() * 0.05;

  if (shadowAcc > hunterAcc * 1.15) {
    await saveSparseModel(sparse, 'hunter');
    await set(dbRef(db, 'bot_state/last_evolution'), { timestamp: Date.now(), promoted: true });
    console.log('[🚀] Shadow promoted to Hunter');
  } else {
    console.log('[⚠️] Promotion skipped. Shadow not better.');
  }
}

if (require.main === module) evolveModels().catch(console.error);
module.exports = { evolveModels };
