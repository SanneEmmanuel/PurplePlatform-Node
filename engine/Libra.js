// libra.js - Advanced AI Core (Firebase Admin SDK Version)
// Author: Dr. Sanne Karibo - PurpleBot AI (Smarter DNN Version)

import admin from 'firebase-admin';
import * as tf from '@tensorflow/tfjs-node';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, access } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccount = {
  "type": "service_account",
  "project_id": "libra-e615f",
  "private_key_id": "6ab1600023c604ec56648d58a63f4c3eb8492aae",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCi3T30udNCqai0\nbtTGKo9dGPA4aNApiV4ucuorcRBUUCb0uWilhRJ9duN6Io7dPsbyZwVLbjTKJqIx\nBLeUv6wz/lQrjOcVhifk1WDvEdHbXdwY4fmj0f8P94VPkhizCIEirXC/ok1biDBQ\nA7QLlCHqRB0OVMoooRN9H+OKC5Ue2Qa9y8VuJjx5wHYpSQGubDnM5cow7/uF2sgc\nPbWNGuGxkMZk3d6JM9MPRfMPDBosqcxXkp9DdHx6pbS6UydIketL8mKIpA3NqTXf\nMDm9yfIcmi3pNuPhyXtYsm3Y0eMLPZQgUbTJjv8no1pTxDLR6++yOO3WXzz5cUlI\ngRWGdDMXAgMBAAECggEAEbAAcgsaaAN/+HSO9CScJEq4kA/GB7TM/zNoviYN1XJN\nAMgAFvXQT8LxKosFQ/704U+R8iK6ZffzJmqyO1vjqlPlNUOctyg2PfJ0kBI53d6g\nMC2ejI2aa1QA7ObbetoiGC+I7q8EQrwULyRv0dAZLNWP6EYKHIZ91Nl5Pz1JySsx\nI3Do8C76FCNgUR7In1sK4RFmdoR+qZG7vWptOxJQTyj1LiUiOvbhe1ex7DSuYJwW\nAj+ICJcprjc158OtNrTBhoXxkmy++bE5fya+64S3nbU3cq3CTfP2PmWDkdYwWYq3\nF5i7Y/3VYP8ApfGSzYemk6DPFAR73eC5+JcAvg4ZrQKBgQDj1xbbLUZ+2lsClBac\nfStjIr44SSOH5JLyxdugSBfTGGaeuSndC3e3CKA7YUMsCbd1P18q9BOAqKCI4X5a\nLuIIDimZyNFpIWGeLtuzcXzBqo8cd5fB0ptCKS3nwNh8OHxJr2/M3N6WfV6GcPGj\nTjqTiXdaksu+Jnp46Cgbm/UOewKBgQC2/ky9Lrs5XYXp+HbMDhIpee4J3FOTZ7fT\nWpXaccpEsdQyrFJACRHSiTQj1lWvz+FuXyC5GAkWPjcEpKOiVsd9+3YE5FrEPKD3\nJsfxPQvZXtMULl9hhEOG8+2M+AaPIn45ZicEsNAVQx4oQAry9huRmN8dgxMqt/eO\nhrCnS9AZFQKBgGANdKBQNREToxyyK9orVthDdGgsRWNr9JuO2Gl5GzouZkzyCPkc\ndYrfgxWlinkNW599aPSl03cBIDS0w9znOPlmZxljNQ2aOhpC7PJ4nLzU1+KLdJoM\n3NGGpMi4X0v3UEaMRJjcYKaXEfuhr+1F9KHwaTXw/x4aALXqQcZp+GTzAoGALjgy\n18G65jVaAouQLeAL9E/osLLmpR+YTZjeqqr9BLbJuvbNW4Eu8DdZZQfY4qwl60O5\ntyZ7/RM/wDt5XSKABrEB0SCAUHpjyakQ7TyXBpMtyzYfPzkx+R8ZS/bFaVez+/ly\nN3wVQpmOP2pVmaJRukebaw/VQn/u1h/s9IRwjjUCgYBDmd9AK0XtJkUhZzgHh+tx\nCbXyqR8kUFYaZJY/dn3G69T4HzKlOWZ/YNWHIzoMxcu9HWFXmqurf4MnCj62749W\n49tZfZ2wo+QJYeWqzwwKjr/DiaLLx/OuWB3LItY40bN/dmMLFS0QAZyXrW/lQgnE\nvoDQ5C1Mq1/d851akPJcTQ==\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@libra-e615f.iam.gserviceaccount.com",
  "client_id": "107473235074187241822",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40libra-e615f.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

if (!admin.apps.length) admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'libra-e615f.appspot.com'
});

const db = admin.firestore();
const storage = admin.storage().bucket();

export function classifyMarket(ticks) {
  const prices = ticks.map(t => t.quote);
  const diff = prices.slice(1).map((p, i) => p - prices[i]);
  const mean = diff.reduce((a, b) => a + b, 0) / diff.length;
  const volatility = Math.sqrt(diff.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / diff.length);
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
  let inputs = [], labels = [], weights = [];
  for (const buffer of echoBuffers) {
    const echo = JSON.parse(zlib.gunzipSync(buffer));
    const features = echo.ticks.map(t => [t.open, t.high, t.low, t.close]);
    const closes = echo.ticks.map(t => t.close);
    const regime = classifyMarket(echo.ticks);
    const importance = regime === 'volatile' ? 1.5 : 1;
    inputs.push(...features);
    labels.push(...closes);
    weights.push(...Array(closes.length).fill(importance));
  }

  const inputTensor = tf.tensor2d(inputs);
  const labelTensor = tf.tensor1d(labels);
  const weightTensor = tf.tensor1d(weights);
  const noise = tf.randomNormal(inputTensor.shape, 0, 0.01);
  const noisyInputs = inputTensor.add(noise);

  const model = buildModel();
  const earlyStopping = tf.callbacks.earlyStopping({ monitor: 'loss', patience: 3 });
  const lrScheduler = tf.callbacks.reduceLROnPlateau({ monitor: 'loss', factor: 0.5, patience: 2 });

  await model.fit(noisyInputs, labelTensor.mul(0.9).add(tf.randomUniform(labelTensor.shape, 0, 0.1)), {
    epochs: 100,
    batchSize: 32,
    sampleWeight: weightTensor,
    callbacks: [earlyStopping, lrScheduler],
    verbose: 0
  });
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
  } catch {
    console.warn(`[⚠️] No sparse weights found for '${type}'`);
  }
}

export function flashUrgency(ticks) {
  const prices = ticks.map(t => t.quote);
  const vol = Math.sqrt(prices.map((v, i) => i > 0 ? Math.pow(v - prices[i - 1], 2) : 0).reduce((a, b) => a + b, 0) / prices.length);
  const momentum = prices.at(-1) - prices[0];
  const rawConfidence = Math.min(1, Math.abs(momentum) * 5);
  const confidence = rawConfidence * (vol > 0.3 ? 1 : 0.8);
  return Math.abs(momentum) > 0.2 && vol > 0.3
    ? { urgency: 'NOW', confidence }
    : { urgency: 'WAIT', confidence: 1 - vol };
}

export async function coreDirection(ticks) {
  const input = tf.tensor2d(ticks.map(t => [t.open, t.high, t.low, t.close]));
  const models = [buildModel(), buildModel(), buildModel()];
  for (const model of models) await loadSparseWeights(model, 'hunter');
  const predictions = models.map(m => m.predict(input).arraySync().pop());
  const avgPrediction = predictions.reduce((a, b) => a + b, 0) / predictions.length;
  const lastClose = ticks.at(-1).close;
  const direction = avgPrediction > lastClose ? 1 : -1;
  const tp = direction > 0 ? lastClose * 1.005 : lastClose * 0.995;
  return { direction, tp, predicted: avgPrediction };
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

export { admin, db, storage };
