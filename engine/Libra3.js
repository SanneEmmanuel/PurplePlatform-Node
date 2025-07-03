// libra3.js - Advanced AI: 5-Tick Prediction, Adaptive Learning, Cloud Save
// Author: Dr. Sanne Karibo - PurpleBot AI Core

import * as tf from '@tensorflow/tfjs-node';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { v2 as cloudinary } from 'cloudinary';
import archiver from 'archiver';

// ⚠️ WARNING: Fake Demo Api Keys – Replace with real keys before deploying
cloudinary.config({ 
  cloud_name: 'dj4bwntzb', 
  api_key: '354656419316393', 
  api_secret: 'M-Trl9ltKDHyo1dIP2AaLOG-WPM' 
});
const publicId = 'libra_v3'; 
if (!cloudinary.config().cloud_name || !cloudinary.config().api_key) {
  console.warn('❌ Cloudinary config invalid — Uploads may fail');
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
  if (ticks.length < 300) {
    console.error('📉 Insufficient data (min 300 ticks)');
    return null;
  }
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
    dataset = extractDataset(ticks);
    if (!dataset) return;
    console.log('✅ Dataset extracted');

    model = buildModel();
    console.log('🧠 Model built successfully');

    console.log('📦 Training model...');
    await model.fit(dataset.xs, dataset.ys, {
      epochs,
      batchSize: 32,
      shuffle: true,
      callbacks: {
        onEpochBegin: e => console.log(`🚀 Epoch ${e + 1}/${epochs}`),
        onEpochEnd: (e, logs) => console.log(`📉 Epoch ${e + 1} Loss: ${logs.loss?.toFixed(6)}`)
      }
    });
    console.log('✅ Training complete');

    const saveDir = '/tmp/model_dir';
    fs.existsSync(saveDir) || (fs.mkdirSync(saveDir, { recursive: true }) && console.log(`📁 Created: ${saveDir}`));
    await model.save(`file://${saveDir}`);
    console.log(`✅ Model saved to ${saveDir}`);

    const fsPromises = await import('fs/promises');
    const files = await fsPromises.readdir(saveDir);
    console.log('📃 model_dir contains:', files);
    if (!files.includes('model.json')) console.warn('⚠️ model.json not found after save');

    // Create ZIP of model_dir
    const zipPath = '/tmp/model.zip';
    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = fs.createWriteStream(zipPath);
    const zipComplete = new Promise((res, rej) => {
      output.on('close', res);
      archive.on('error', rej);
    });
    archive.pipe(output);
    archive.directory(saveDir, false);
    archive.finalize();
    await zipComplete;
    console.log(`📦 Zipped model to ${zipPath}`);

    // Upload ZIP with retries
    async function retryUpload(filePath, retries = 3, delay = 2000) {
      for (let i = 0; i < retries; i++) {
        try {
          return await cloudinary.uploader.upload(filePath, {
  resource_type: 'raw',
  public_id: publicId,         
  type: 'upload',          // ⚠️ This ensures it's private. Default is 'upload'
});

        } catch (err) {
          console.warn(`⏳ Upload failed for ${path.basename(filePath)}. Retry ${i + 1}/${retries}`);
          if (i === retries - 1) throw err;
          await new Promise(res => setTimeout(res, delay));
        }
      }
    }

    try {
      console.log('☁️ Uploading model ZIP to Cloudinary...');
      const uploaded = await retryUpload(zipPath);
      console.log('☁️ ZIP uploaded:', uploaded.secure_url);
    } catch (uploadErr) {
      console.warn('❌ Failed to upload ZIP:', uploadErr);
    }

    modelReady = true;
    console.log('✅ Model is ready for use');
  } catch (err) {
    console.error('💥 Training process failed:', err.message);
  } finally {
    cloudinary.api.resource(publicId, { resource_type: 'raw' })
  .then(res => console.log('✅ Verification File exists:', res.secure_url))
  .catch(err => console.error('❌ Verification File not found:', err.message));
    if (dataset) {
      tf.dispose([dataset.xs, dataset.ys]);
      console.log('🧹 Tensors disposed');
    }
  }
}


export const loadModelFromCloudinary = (async () => {
  try {
    const modelDir = '/tmp/model_dir';
    const zipPath = '/tmp/downloaded_model.zip';
    const zipUrl = cloudinary.url(publicId, {
      resource_type: 'raw',
      sign_url: true,
      type: 'upload',
      attachment: true,
      expires_at: Math.floor(Date.now() / 1000) + 600 // 10 minutes
    });
    
    fs.mkdirSync('/tmp', { recursive: true });
    console.log('📥 Downloading model ZIP from Cloudinary...');
    const res = await fetch(zipUrl);

    if (!res.ok) {
      console.error('🚫 ZIP download failed:', res.statusText);
      return;
    }

    fs.writeFileSync(zipPath, await res.buffer());
    console.log(`📦 ZIP saved to ${zipPath}`);

    const unzipper = await import('unzipper');
    await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: modelDir })).promise();
    console.log(`🗂️ ZIP extracted to ${modelDir}`);

    model = await tf.loadLayersModel(`file://${path.resolve(modelDir)}/model.json`);
    modelReady = true;
    console.log('✅ Model and weights loaded from Cloudinary');
  } catch (err) {
    console.error('❌ Failed to load model from Cloudinary:', err.message);    
  }
})();


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
    archive.directory('./tmp/model_dir/', false);
    archive.finalize();
  });
}

export async function uploadModelFromDisk(filepath = './model_dir/model.json') {
  if (!fs.existsSync(filepath)) {
    console.warn('❌ Model file not found');
    return;
  }

  try {
    const res = await cloudinary.uploader.upload(filepath, {
      resource_type: 'raw',
      public_id: publicId
    });
    console.log('☁️ Manual upload complete:', res.secure_url);
  } catch (err) {
    console.warn('❌ Upload failed:', err.message);
  }
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
    console.warn('❌ Invalid adaptation data');
    return;
  }

  const input = ticks.slice(-295).map(t => [t.close || t.quote]);
  const xs = tf.tensor3d([input], [1, 295, 1]);
  const ys = tf.tensor2d([actualNext5], [1, 5]);

  await model.fit(xs, ys, { epochs: 5, batchSize: 1 });
  tf.dispose([xs, ys]);
  console.log('🔁 Retrained on failure data');
}

export function tradeAdvice(predicted, actuals, entryPrice, currentPositionSize = 1, maxPositionSize = 16) {
  if (predicted.length !== 5 || actuals.length !== 5) {
    console.warn('❌ Invalid prediction/actuals length');
    return null;
  }

  const avgPrediction = predicted.reduce((a, b) => a + b, 0) / predicted.length;
  const avgActual = actuals.reduce((a, b) => a + b, 0) / actuals.length;

  const direction = avgPrediction > entryPrice ? 'CALL' : 'PUT';
  const outcome = avgActual > entryPrice ? 'WIN' : 'LOSS';
  const error = Math.abs(avgPrediction - avgActual);

  let action = 'hold';
  let newPositionSize = currentPositionSize;

  if (outcome === 'WIN' && currentPositionSize < maxPositionSize) {
    action = 'add';
    newPositionSize = Math.min(currentPositionSize * 2, maxPositionSize);
  } else if (outcome === 'LOSS' && currentPositionSize > 1) {
    action = 'reduce';
    newPositionSize = Math.max(1, Math.floor(currentPositionSize / 2));
  }

  console.log(`📊 Entry: ${entryPrice} | Prediction Avg: ${avgPrediction.toFixed(5)} | Actual Avg: ${avgActual.toFixed(5)}`);
  console.log(`📈 Direction: ${direction} | Outcome: ${outcome} | Error: ${error.toFixed(5)}`);
  console.log(`⚙️ Action: ${action} | Position Size: ${newPositionSize}`);
  return { direction, outcome, error: error.toFixed(5), action, newPositionSize };
}
