// libra3.js - Fully Optimized Version with All Original Functions
// Author: Dr. Sanne Karibo - PurpleBot AI Core (Optimized Implementation)

import * as tf from '@tensorflow/tfjs-node';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { v2 as cloudinary } from 'cloudinary';
import archiver from 'archiver';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

// ==================== CONFIGURATION ====================
const CONFIG = {
  CLOUDINARY: {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dj4bwntzb',
    api_key: process.env.CLOUDINARY_API_KEY || '354656419316393',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'M-Trl9ltKDHyo1dIP2AaLOG-WPM'
  },
  MODEL: {
    batchSize: 64,
    validationSplit: 0.2,
    shuffleWindow: 1000
  }
};

// Initialize Cloudinary
cloudinary.config(CONFIG.CLOUDINARY);
if (!cloudinary.config().cloud_name || !cloudinary.config().api_key) {
  console.warn('❌ Cloudinary config invalid — Uploads may fail');
}

// ==================== STATE MANAGEMENT ====================
let model;
let modelReady = false;
let modelLoadPromise = null;

// ==================== CORE FUNCTIONS ====================

function waitUntilReady() {
  return modelReady ? Promise.resolve() : modelLoadPromise || Promise.reject('🕒 Model not loading yet');
}

function buildModel() {
  console.log('🏗️ Building optimized model architecture');
  const m = tf.sequential();
  m.add(tf.layers.inputLayer({ inputShape: [295, 1] }));
  m.add(tf.layers.lstm({ units: 128, returnSequences: true }));
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.lstm({ units: 64, returnSequences: false }));
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  m.add(tf.layers.dense({ units: 5 }));
  
  m.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError',
    metrics: ['mae']
  });
  return m;
}

// ==================== OPTIMIZED DATA PROCESSING ====================

function createDatasetInWorker(ticks) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { ticks }
    });
    
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}

function createDataset(ticks) {
  if (!isMainThread) {
    // Worker thread execution path
    const result = extractDatasetGPU(workerData.ticks);
    parentPort.postMessage(result);
    return;
  }

  return tf.tidy(() => {
    const numSamples = ticks.length - 300;
    if (numSamples <= 0) {
      console.error('📉 Insufficient data (min 300 ticks)');
      return null;
    }

    // GPU-optimized buffer allocation
    const inputBuffer = new Float32Array(numSamples * 295);
    const labelBuffer = new Float32Array(numSamples * 5);

    // Parallel-friendly data preparation
    for (let sample = 0; sample < numSamples; sample++) {
      const inputOffset = sample * 295;
      const labelOffset = sample * 5;
      
      for (let i = 0; i < 295; i++) {
        inputBuffer[inputOffset + i] = ticks[sample + i].close || ticks[sample + i].quote;
      }
      
      for (let i = 0; i < 5; i++) {
        labelBuffer[labelOffset + i] = ticks[sample + 295 + i].close || ticks[sample + 295 + i].quote;
      }
    }

    return {
      xs: tf.tensor3d(inputBuffer, [numSamples, 295, 1]),
      ys: tf.tensor2d(labelBuffer, [numSamples, 5])
    };
  });
}

function extractDatasetGPU(ticks) {
  return tf.tidy(() => {
    const numSamples = ticks.length - 300;
    if (numSamples <= 0) return null;

    const inputBuffer = new Float32Array(numSamples * 295);
    const labelBuffer = new Float32Array(numSamples * 5);

    for (let sample = 0; sample < numSamples; sample++) {
      const inputOffset = sample * 295;
      const labelOffset = sample * 5;
      
      for (let i = 0; i < 295; i++) {
        inputBuffer[inputOffset + i] = ticks[sample + i].close || ticks[sample + i].quote;
      }
      
      for (let i = 0; i < 5; i++) {
        labelBuffer[labelOffset + i] = ticks[sample + 295 + i].close || ticks[sample + 295 + i].quote;
      }
    }

    return {
      xs: tf.tensor3d(inputBuffer, [numSamples, 295, 1]),
      ys: tf.tensor2d(labelBuffer, [numSamples, 5])
    };
  });
}

// ==================== TRAINING PIPELINE ====================

export async function trainWithTicks(ticks, epochs = 50) {
  await waitUntilReady();
  console.log('🔍 Starting optimized training with', ticks.length, 'ticks');
  
  let dataset;
  try {
    // Concurrent initialization pipeline
    const [datasetResult, currentModel] = await Promise.all([
      isMainThread ? createDatasetInWorker(ticks) : createDataset(ticks),
      model || buildModel()
    ]);
    
    dataset = datasetResult;
    if (!dataset) return;
    
    model = currentModel;
    console.log('⚡ Dataset prepared | Model ready');

    // Training with overlapped save/upload
    console.log('🚀 Starting optimized training...');
    await model.fit(dataset.xs, dataset.ys, {
      epochs,
      batchSize: CONFIG.MODEL.batchSize,
      validationSplit: CONFIG.MODEL.validationSplit,
      shuffle: CONFIG.MODEL.shuffleWindow,
      callbacks: {
        onEpochBegin: (epoch) => console.log(`🚀 Epoch ${epoch + 1}/${epochs}`),
        onEpochEnd: async (epoch, logs) => {
          console.log(`📉 Epoch ${epoch + 1} Loss: ${logs.loss.toFixed(6)} | Val Loss: ${logs.val_loss?.toFixed(6) || 'N/A'}`);
          
          // Final epoch operations
          if (epoch === epochs - 1) {
            await finalizeTraining();
          }
        }
      }
    });

    modelReady = true;
    console.log('✅ Training complete and model ready');
  } catch (err) {
    console.error('💥 Training process failed:', err.message);
  } finally {
    if (dataset) {
      tf.dispose([dataset.xs, dataset.ys]);
      console.log('🧹 Tensors disposed');
    }
  }
}

async function finalizeTraining() {
  try {
    console.log('💾 Starting model save pipeline...');
    const savePath = 'file://./model_dir';
    
    // Parallel save operations
    await Promise.all([
      model.save(savePath),
      backupModelToCloud()
    ]);
    
    console.log('✅ Model saved and backed up');
  } catch (err) {
    console.warn('⚠️ Finalization error:', err.message);
  }
}

async function backupModelToCloud() {
  try {
    console.log('☁️ Starting cloud backup...');
    const uploadRes = await cloudinary.uploader.upload('./model_dir/model.json', {
      resource_type: 'raw',
      public_id: `libra_model_${Date.now()}`
    });
    console.log('☁️ Model uploaded to Cloudinary:', uploadRes.secure_url);
  } catch (err) {
    console.warn('❌ Cloud backup failed:', err.message);
  }
}

// ==================== ORIGINAL FUNCTIONS (OPTIMIZED) ====================

export async function loadModelFromCloudinary() {
  modelLoadPromise = (async () => {
    try {
      const modelUrl = process.env.CLOUDINARY_MODEL_JSON_URL;
      const weightsUrl = modelUrl.replace('.json', '.weights.bin');
      const modelDir = './model_dir';

      const [jsonRes, weightsRes] = await Promise.all([
        fetch(modelUrl),
        fetch(weightsUrl)
      ]);

      if (!jsonRes.ok || !weightsRes.ok) {
        throw new Error('🚫 Download failed');
      }

      const [json, weights] = await Promise.all([
        jsonRes.text(),
        weightsRes.arrayBuffer()
      ]);

      if (!fs.existsSync(modelDir)) {
        fs.mkdirSync(modelDir, { recursive: true });
      }
      
      fs.writeFileSync(`${modelDir}/model.json`, json);
      fs.writeFileSync(`${modelDir}/model.weights.bin`, Buffer.from(weights));

      model = await tf.loadLayersModel(`file://${path.resolve(modelDir)}/model.json`);
      modelReady = true;
      console.log('📥 Model loaded from Cloudinary');
    } catch (err) {
      console.error('❌ Failed to load model from Cloudinary:', err.message);
      // Fallback to new model if loading fails
      model = buildModel();
      modelReady = true;
    }
  })();
  return modelLoadPromise;
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
      resolve(destination);
    });

    archive.on('error', err => reject(err));
    archive.pipe(output);
    archive.directory('./model_dir/', false);
    archive.finalize();
  });
}

export async function uploadModelFromDisk(filepath = './model_dir/model.json') {
  if (!fs.existsSync(filepath)) {
    console.warn('❌ Model file not found');
    return null;
  }

  try {
    const res = await cloudinary.uploader.upload(filepath, {
      resource_type: 'raw',
      public_id: `libra_model_manual_${Date.now()}`
    });
    console.log('☁️ Manual upload complete:', res.secure_url);
    return res.secure_url;
  } catch (err) {
    console.warn('❌ Upload failed:', err.message);
    return null;
  }
}

export async function predictNext5(ticks) {
  await waitUntilReady();
  if (ticks.length < 295) throw new Error('📉 Insufficient ticks (min 295)');

  return tf.tidy(() => {
    // GPU-optimized prediction
    const inputBuffer = new Float32Array(295);
    for (let i = 0; i < 295; i++) {
      inputBuffer[i] = ticks[ticks.length - 295 + i].close || ticks[ticks.length - 295 + i].quote;
    }
    
    const xs = tf.tensor3d([inputBuffer], [1, 295, 1]);
    return model.predict(xs).arraySync()[0];
  });
}

export async function adaptOnFailure(ticks, actualNext5) {
  await waitUntilReady();
  if (ticks.length < 295 || actualNext5.length !== 5) {
    console.warn('❌ Invalid adaptation data');
    return false;
  }

  // GPU-optimized adaptation
  const inputBuffer = new Float32Array(295);
  for (let i = 0; i < 295; i++) {
    inputBuffer[i] = ticks[ticks.length - 295 + i].close || ticks[ticks.length - 295 + i].quote;
  }

  const xs = tf.tensor3d([inputBuffer], [1, 295, 1]);
  const ys = tf.tensor2d([actualNext5], [1, 5]);

  try {
    await model.fit(xs, ys, { 
      epochs: 5, 
      batchSize: 1,
      callbacks: {
        onTrainEnd: () => tf.dispose([xs, ys])
      }
    });
    console.log('🔁 Model adapted to new data');
    return true;
  } catch (err) {
    console.warn('⚠️ Adaptation failed:', err.message);
    return false;
  }
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

  return { 
    direction, 
    outcome, 
    error: error.toFixed(5), 
    action, 
    newPositionSize,
    confidence: 1 - (error / entryPrice) // Added confidence metric
  };
}

// ==================== INITIALIZATION ====================
if (isMainThread) {
  loadModelFromCloudinary();
} else {
  // Worker thread execution
  const result = createDataset(workerData.ticks);
  parentPort.postMessage(result);
}
