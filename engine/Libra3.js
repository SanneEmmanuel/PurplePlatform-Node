// libra.js - Advanced AI: 5-Tick Prediction, Adaptive Learning, Cloud Save
// Author: Dr. Sanne Karibo - PurpleBot AI Core

import * as tf from '@tensorflow/tfjs-node';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { v2 as cloudinary } from 'cloudinary';
import archiver from 'archiver';


// ⚠️ WARNING: Fake Demo Api Keys Fix in Original Keys before running
cloudinary.config({ 
  cloud_name: 'dj4bwntzb', 
  api_key: '354656419316393', 
  api_secret: 'M-Trl9ltKDHyo1dIP2AaLOG-WPM' 
});


if (!cloudinary.config().cloud_name || !cloudinary.config().api_key) {
  throw new Error('❌ Invalid Cloudinary configuration');
}


let model;
let modelReady = false;

function buildModel() {
  const m = tf.sequential();
  m.add(tf.layers.inputLayer({ inputShape: [295, 1] }));
  m.add(tf.layers.lstm({ units: 128, returnSequences: true }));
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.lstm({ units: 64, returnSequences: false }));
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  m.add(tf.layers.dense({ units: 5 }));
  m.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
  return m;
}

function extractDataset(ticks) {
  if (ticks.length < 300) throw new Error('📉 Insufficient data (min 300 ticks)');
  return tf.tidy(() => {
    const inputs = [], labels = [];
    for (let i = 0; i <= ticks.length - 300; i++) {
      const input = ticks.slice(i, i + 295).map(t => [t.close || t.quote]);
      const label = ticks.slice(i + 295, i + 300).map(t => t.close || t.quote);
      inputs.push(input);
      labels.push(label);
    }
    return {
      xs: tf.tensor3d(inputs),
      ys: tf.tensor2d(labels)
    };
  });
}

export async function trainWithTicks(ticks, epochs = 50) {
  console.log('🔍 Starting training with', ticks.length, 'ticks');
  let dataset;

  try {
    // Step 1: Extract dataset
    dataset = extractDataset(ticks);
    console.log('✅ Dataset extracted');

    // Step 2: Build model
    model = buildModel();
    console.log('🧠 Model built successfully');

    // Step 3: Train model
    console.log('📦 Training model...');
    await model.fit(dataset.xs, dataset.ys, {
      epochs,
      batchSize: 32,
      shuffle: true,
      callbacks: {
        onEpochBegin: epoch => console.log(`🚀 Epoch ${epoch + 1}/${epochs}`),
        onEpochEnd: (epoch, logs) => {
          console.log(`📉 Epoch ${epoch + 1} Loss: ${logs.loss?.toFixed(6)}`);
        }
      }
    });
    console.log('✅ Training complete');

    // Step 4: Save model to local disk
try{
    console.log('💾 Saving model to disk...');
    await model.save('file://./model_dir');
    console.log('✅ Model saved to ./model_dir');
}catch(errs){console.error('failed to save to disk',errs);}
    // Step 5: Confirm model.json exists
   try{
    const fs = await import('fs/promises');
    console.log('📁 Checking model_dir contents...');
    const files = await fs.readdir('./model_dir');
    console.log('📃 model_dir contains:', files);
    if (!files.includes('model.json')) {
      throw new Error('model.json not found after save');
    }
   }catch(errs){console.error("Couldn't Read Directory",errs);}
    // Step 6: Upload to Cloudinary
try{
    console.log('☁️ Uploading model.json to Cloudinary...');
    const uploadRes = await cloudinary.uploader.upload('./model_dir/model.json', {
      resource_type: 'raw',
      public_id: 'libra_model'
    });
    console.log('☁️ Model uploaded to Cloudinary:', uploadRes.secure_url);
}catch(errs){console.error("Failed to upload",errs);}
    // Step 7: Mark model as ready
    modelReady = true;
    console.log('✅ Model is ready for use');
    
  } catch (err) {
    console.error('❌ Training process failed:', err);
  } finally {
    // Always dispose tensors
    if (dataset) {
      try {
        tf.dispose([dataset.xs, dataset.ys]);
        console.log('🧹 Tensors disposed');
      } catch (disposeErr) {
        console.warn('⚠️ Tensor disposal failed:', disposeErr);
      }
    }
  }
}


export async function loadModelFromCloudinary() {
  const modelUrl = process.env.CLOUDINARY_MODEL_JSON_URL;
  const weightsUrl = modelUrl.replace('.json', '.weights.bin');
  const modelDir = './model_dir';

  const [jsonRes, weightsRes] = await Promise.all([
    fetch(modelUrl),
    fetch(weightsUrl)
  ]);

  if (!jsonRes.ok) throw new Error(`🚫 Model JSON download failed: ${jsonRes.status}`);
  if (!weightsRes.ok) throw new Error(`🚫 Weights BIN download failed: ${weightsRes.status}`);

  const [json, weights] = await Promise.all([
    jsonRes.text(),
    weightsRes.arrayBuffer()
  ]);

  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(`${modelDir}/model.json`, json);
  fs.writeFileSync(`${modelDir}/model.weights.bin`, Buffer.from(weights));

  model = await tf.loadLayersModel(`file://${path.resolve(modelDir)}/model.json`);
  modelReady = true;
  console.log('📥 Model loaded from Cloudinary');
}

export function isModelReady() {
  return modelReady;
}

export async function downloadCurrentModel(destination = './downloaded_model.zip') {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`📦 Model archived: ${archive.pointer()} bytes`);
      resolve();
    });

    archive.on('error', err => reject(err));
    archive.pipe(output);
    archive.directory('./model_dir/', false);
    archive.finalize();
  });
}

export async function uploadModelFromDisk(filepath = './model_dir/model.json') {
  if (!fs.existsSync(filepath)) throw new Error('❌ Model file not found');
  const res = await cloudinary.uploader.upload(filepath, {
    resource_type: 'raw',
    public_id: 'libra_model_manual'
  });
  console.log('☁️ Manual upload complete:', res.secure_url);
}

export async function predictNext5(ticks) {
  if (!modelReady) throw new Error('Model not loaded');
  if (ticks.length < 295) throw new Error('📉 Insufficient ticks (min 295)');

  return tf.tidy(() => {
    const input = ticks.slice(-295).map(t => [t.close || t.quote]);
    const xs = tf.tensor3d([input], [1, 295, 1]);
    const prediction = model.predict(xs);
    return prediction.arraySync()[0];
  });
}

export async function adaptOnFailure(ticks, actualNext5) {
  if (!modelReady) throw new Error('Model not loaded');
  if (ticks.length < 295 || actualNext5.length !== 5) {
    throw new Error('❌ Invalid adaptation data');
  }

  const input = ticks.slice(-295).map(t => [t.close || t.quote]);
  const xs = tf.tensor3d([input], [1, 295, 1]);
  const ys = tf.tensor2d([actualNext5], [1, 5]);

  await model.fit(xs, ys, { epochs: 5, batchSize: 1 });
  tf.dispose([xs, ys]);
  console.log('🔁 Retrained on failure data');
}

/**
 * tradeAdvice with simple pyramiding logic.
 * 
 * @param {number[]} predicted - Array of predicted prices for next 5 ticks
 * @param {number[]} actuals - Array of actual prices for next 5 ticks (for evaluation)
 * @param {number} entryPrice - Price at trade entry
 * @param {number} currentPositionSize - Current number of lots/contracts held
 * @param {number} maxPositionSize - Maximum allowed position size (pyramid cap)
 * @returns {object} - Advice including direction, outcome, error, action, and new position size
 */
export function tradeAdvice(predicted, actuals, entryPrice, currentPositionSize = 1, maxPositionSize = 16) {
  if (predicted.length !== 5 || actuals.length !== 5) {
    throw new Error('❌ Invalid prediction/actuals length');
  }

  const avgPrediction = predicted.reduce((a, b) => a + b, 0) / predicted.length;
  const avgActual = actuals.reduce((a, b) => a + b, 0) / actuals.length;

  const direction = avgPrediction > entryPrice ? 'CALL' : 'PUT';
  const outcome = avgActual > entryPrice ? 'WIN' : 'LOSS';
  const error = Math.abs(avgPrediction - avgActual);

  // Simple pyramiding logic:
  let action = 'hold';
  let newPositionSize = currentPositionSize;

  if (outcome === 'WIN' && currentPositionSize < maxPositionSize) {
    action = 'add';  // Pyramid: add to winning position
    newPositionSize = Math.min(currentPositionSize * 2, maxPositionSize);
  } else if (outcome === 'LOSS' && currentPositionSize > 1) {
    action = 'reduce'; // Reduce position or exit partially
    newPositionSize = Math.max(1, Math.floor(currentPositionSize / 2));
  }

  console.log(`📊 Entry: ${entryPrice} | Prediction Avg: ${avgPrediction.toFixed(5)} | Actual Avg: ${avgActual.toFixed(5)}`);
  console.log(`📈 Direction: ${direction} | Outcome: ${outcome} | Error: ${error.toFixed(5)}`);
  console.log(`⚙️ Action: ${action} | Position Size: ${newPositionSize}`);

  return { direction, outcome, error: error.toFixed(5), action, newPositionSize };
}
