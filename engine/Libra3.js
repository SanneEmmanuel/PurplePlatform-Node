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
const publicId = 'libra_v4.zip'; 
if (!cloudinary.config().cloud_name || !cloudinary.config().api_key) {
  console.warn('❌ Cloudinary config invalid — Uploads may fail');
}

let model;
let modelReady = false;

function buildModel() {
    const m = tf.sequential();
m.add(tf.layers.lstm({ units: 64, inputShape: [295, 1], returnSequences: true }));
m.add(tf.layers.dropout({ rate: 0.2 }));
m.add(tf.layers.lstm({ units: 32 }));
m.add(tf.layers.dense({ units: 5 }));

const opt = tf.train.adam(0.001, 0.9, 0.999, 1e-8, { clipNorm: 5 });
m.compile({ optimizer: opt, loss: 'meanSquaredError', metrics: ['mae'] });
   
    return m;
}

function extractDataset(ticks) {
  if (!Array.isArray(ticks) || ticks.length < 304) { // Minimum 295 + 5 + 4
    console.warn(`❌ Insufficient ticks (${ticks.length}). Need at least 304.`);
    return null;
  }

  return tf.tidy(() => {
    const inputs = [], labels = [];
    const WINDOW = 295, STEPS = 5;

    // Pre-validate all ticks
    const invalidTicks = ticks.some(t => t <= 0 || !Number.isFinite(t));
    if (invalidTicks) {
      console.warn('❌ Dataset contains invalid ticks (zero, negative, or NaN)');
      return null;
    }

    // Safe log-return calculation with clipping
    const safeLogReturn = (a, b) => {
      const ratio = b / a;
      return Math.log(Math.max(1e-7, Math.min(ratio, 1e7)));
    };

    for (let i = 0; i <= ticks.length - WINDOW - STEPS - 4; i++) {
      try {
        // 1. Calculate SMA for first feature
        const smaWindow = ticks.slice(i, i + 5);
        const sma = smaWindow.reduce((a, b) => a + b, 0) / 5;
        const input = [[safeLogReturn(sma, ticks[i + 4])]];
        
        // 2. Add remaining 294 log returns
        for (let j = i + 4; j < i + 4 + WINDOW - 1; j++) {
          input.push([safeLogReturn(ticks[j], ticks[j + 1])]);
        }

        // 3. Calculate labels (5-step log returns)
        const label = [];
        const labelStart = i + WINDOW + 3; // i+4 + (WINDOW-1)
        for (let k = labelStart; k < labelStart + STEPS; k++) {
          label.push(safeLogReturn(ticks[k], ticks[k + 1]));
        }

        // Verify no NaN/Infinity in the window
        const hasInvalid = [...input.flat(), ...label].some(v => !Number.isFinite(v));
        if (!hasInvalid) {
          inputs.push(input);
          labels.push(label);
        }
      } catch (err) {
        console.warn(`⚠️ Skipped window at i=${i}:`, err.message);
        continue;
      }
    }

    if (inputs.length === 0) {
      console.warn('❌ No valid windows extracted');
      return null;
    }

    console.log(`✅ Extracted ${inputs.length} valid samples`);
    return {
      xs: tf.tensor3d(inputs, [inputs.length, WINDOW, 1]),
      ys: tf.tensor2d(labels, [labels.length, STEPS])
    };
  });
}

function decodeLogReturns(base, encodedReturns) {
  return encodedReturns.reduce((arr, logChange) => {
    const next = arr[arr.length - 1] * Math.exp(logChange);
    return [...arr, next];
  }, [base]).slice(1);
}

export async function trainWithTicks(ticks, epochs = 50) {
  console.log('✊ First Tick:', ticks[0]);
  let dataset;

  try {console.log
    dataset = extractDataset(ticks); // Converts prices to log returns for training
    if (!dataset || dataset.xs.shape[0] === 0) {
  console.warn('❌ No valid dataset extracted from ticks.');
  return;
}
console.log(`📊 Dataset ready: ${dataset.xs.shape[0]} samples`);

    console.log('✅ Dataset extracted');

    if (!modelReady) {
      model = buildModel();
      console.log('🧠 Model built Afresh successfully');
    } else {
      console.log('📡 Resuming training with loaded model...');
    }

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

    // Zip and upload
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

    async function retryUpload(filePath, retries = 3, delay = 2000) {
      for (let i = 0; i < retries; i++) {
        try {
          return await cloudinary.uploader.upload(filePath, {
            resource_type: 'raw',
            public_id: publicId,
            type: 'upload'
          });
        } catch (err) {
          console.warn(`⏳ Upload failed (${i + 1}/${retries})`);
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
    //Download and retry
    const res = await (async (u,r=3,d=1000)=>{while(r--){const x=await fetch(u).catch(()=>({}));if(x.ok)return x;
     console.error(`🚫 ZIP download failed${r?' (retrying...)':''}:`,x.statusText||'Network error');
     if(r)await new Promise(y=>setTimeout(y,d))}})(zipUrl);

    fs.writeFileSync(zipPath, await res.buffer());
    console.log(`📦 ZIP saved to ${zipPath}`);

    const unzipper = await import('unzipper');
    await fs.createReadStream(zipPath).pipe(unzipper.Extract({ path: modelDir })).promise();
    console.log(`🗂️ ZIP extracted to ${modelDir}`);

    model = await tf.loadLayersModel(`file://${path.resolve(modelDir)}/model.json`);
    m.compile({ optimizer: opt, loss: 'meanSquaredError', metrics: ['mae'] });
   
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
  if (ticks.length < 296) throw new Error('📉 Insufficient ticks (min 296)');

  return tf.tidy(() => {
    const basePrice = ticks[ticks.length - 1];
    const input = [];

    for (let i = ticks.length - 296; i < ticks.length; i++) {
      const curr = ticks[i], next = ticks[i + 1];
      if (!curr || !next || curr <= 0 || next <= 0) {
        throw new Error('❌ Invalid tick in prediction input');
      }
      input.push([Math.log(next / curr)]);
    }

    const xs = tf.tensor3d([input], [1, 295, 1]);
    const predictedLogReturns = model.predict(xs).arraySync()[0];
    const predictedPrices = decodeLogReturns(basePrice, predictedLogReturns);

    return predictedPrices;
  });
}



export async function adaptOnFailure(ticks, actualNext5) {
  if (!modelReady) throw new Error('Model not loaded');
  if (ticks.length < 296 || actualNext5.length !== 5) {
    console.warn('❌ Invalid adaptation data');
    return;
  }

  const lastPrice = ticks[ticks.length - 1];
  if (!lastPrice || lastPrice <= 0) {
    console.warn('❌ Invalid last price for log return conversion');
    return;
  }

  const actualLogReturns = actualNext5.map((p, i) =>
    i === 0 ? Math.log(p / lastPrice) : Math.log(p / actualNext5[i - 1])
  );

  const input = [];
  for (let i = ticks.length - 296; i < ticks.length; i++) {
    const curr = ticks[i], next = ticks[i + 1];
    if (!curr || !next || curr <= 0 || next <= 0) {
      console.warn('❌ Skipped invalid adaptation input');
      return;
    }
    input.push([Math.log(next / curr)]);
  }

  const xs = tf.tensor3d([input], [1, 295, 1]);
  const ys = tf.tensor2d([actualLogReturns], [1, 5]);

  await model.fit(xs, ys, { epochs: 5, batchSize: 1 });
  tf.dispose([xs, ys]);

  console.log('🔁 Retrained on failure data (converted to log returns)');
}



export function tradeAdviceEncoded(predictedLogReturns, actualPrices, entryPrice, currentPositionSize = 1, maxPositionSize = 16) {
  if (predictedLogReturns.length !== 5 || actualPrices.length !== 5) {
    console.warn('❌ Invalid prediction or actuals length');
    return null;
  }

  const predictedPrices = decodeLogReturns(entryPrice, predictedLogReturns);
  const avgPrediction = predictedPrices.reduce((a, b) => a + b, 0) / 5;
  const avgActual = actualPrices.reduce((a, b) => a + b, 0) / 5;

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
