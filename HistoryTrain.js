// HistoryTrain.js - Dr. Sanne Karibo (Google Drive Save Edition)
// Granular error handling with detailed try-catch per step

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { trainWithTicks, downloadCurrentModel } from './engine/Libra3.js';
import { getTicksForTraining, waitReady } from './deriv.js';

const ZIP_PATH = './downloads/LibraModel.zip';

async function train(batchCount = 1, epochs = 100) {
  const totalTicks = batchCount * 300;
  console.log('🛠️  Step 1: Initializing Deriv connection...');

  console.log(`🎯 Step 2: Fetching ${totalTicks} ticks...`);
  let ticks;
  try {
    const result = await getTicksForTraining(totalTicks);
    ticks = result.ticks;
    console.log(`✅ Retrieved ${ticks.length} ticks`);
  } catch (err) {
    console.error('❌ Error in getTicksForTraining():', err.message);
    return;
  }

  if (!Array.isArray(ticks) || ticks.length < 300) {
    console.error('❌ Not enough ticks. Received:', ticks?.length);
    return;
  }

  console.log('📦 Step 3: Training model with ticks...');
  try {
    await trainWithTicks(ticks, epochs);
    console.log('✅ Model training complete');
  } catch (err) {
    console.error('❌ Error in trainWithTicks():', err.message);
    return;
  }

  console.log('📁 Step 4: Ensuring download directory exists...');
  try {
    fs.mkdirSync(path.dirname(ZIP_PATH), { recursive: true });
    console.log('✅ Download directory ready');
  } catch (err) {
    console.error('⚠️ Could not create download directory:', err.message);
    // proceed, download may still succeed
  }

  console.log('📦 Step 5: Archiving model to ZIP...');
  try {
    await downloadCurrentModel(ZIP_PATH);
    console.log('✅ Model archived at', ZIP_PATH);
  } catch (err) {
    console.error('❌ Error in downloadCurrentModel():', err.message);
    return;
  }

  console.log('🏁 Training workflow finished successfully');
  console.log('📤 To upload to Google Drive in Colab, use:');
  console.log(`
from google.colab import files
files.download("${ZIP_PATH}")
`);
}

const batches = parseInt(process.argv[2], 10) || 1;
const epochs = parseInt(process.argv[3], 10) || 50;

train(batches, epochs);
