// HistoryTrain.js - Dr. Sanne Karibo (Google Drive Save Edition)
// Modified to suppress error throwing

import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import dotenv from 'dotenv';
import { trainWithTicks, downloadCurrentModel } from './engine/Libra3.js';
import { getTicksForTraining, waitReady } from './deriv.js';

dotenv.config();

const ZIP_PATH = './downloads/LibraModel.zip';

async function train(batchCount = 1, epochs = 100) {
  try {
    const totalTicks = batchCount * 300;
    console.log('Preparing Deriv...');
    await waitReady();

    console.log(`🎯 Fetching ${totalTicks} ticks...`);
    const { ticks } = await getTicksForTraining(totalTicks);

    if (!ticks?.length || ticks.length < 300) {
      console.error('❌ Not enough ticks. Aborting training.');
      return;
    }

    console.log('🛠️  Training with ticks...');
    await trainWithTicks(ticks, epochs);

    // Ensure the local download directory exists
    fs.mkdirSync(path.dirname(ZIP_PATH), { recursive: true });
    console.log('📦 Saving model as ZIP...');
    await downloadCurrentModel(ZIP_PATH);

    console.log('📁 Model saved locally at:', ZIP_PATH);
    console.log('📤 To upload to Google Drive in Colab, use:');
    console.log(`
from google.colab import files
files.download("${ZIP_PATH}")
`);

  } catch (err) {
    console.error('⚠️ Training encountered an error:', err.message);
    // Errors are logged but not re-thrown
  }
}

const batches = parseInt(process.argv[2], 10) || 1;
const epochs = parseInt(process.argv[3], 10) || 50;

train(batches, epochs);
