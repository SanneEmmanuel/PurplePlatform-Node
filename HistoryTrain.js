// HistoryTrain.js - Dr. Sanne Karibo (Google Drive Save Edition)
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import dotenv from 'dotenv';
dotenv.config();

import { trainWithTicks, downloadCurrentModel } from './engine/Libra3.js';
import { getTicksForTraining, pingServer} from './deriv.js';

const ZIP_PATH = './downloads/LibraModel.zip';

async function getTicksWithRetry(totalTicks) {
  while (true) {
    try {
      const ticks  = await getTicksForTraining(totalTicks);
            return ticks;
    } catch (err) {
      console.warn('⚠️ Tick fetch failed, retrying in 1s...', err.message);
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}

async function train(batchCount = 1, epochs = 100) {
  const totalTicks = batchCount * 304;
  console.log('Preparing Deriv...');
  console.log(`🎯 Fetching ${totalTicks} ticks...`);
  const ticks = await getTicksWithRetry(totalTicks);
  pingServer();

  // Train the Libra model using ticks
  console.log('Training with ticks');
  await trainWithTicks(ticks, epochs);

  // Ensure the local download directory exists
  fs.mkdirSync('./downloads', { recursive: true });
  console.log('saving Zip Mode');

  // Save model to ZIP using Libra's built-in archiver
  await downloadCurrentModel(ZIP_PATH);

  console.log('📁 Model saved locally at:', ZIP_PATH);
  console.log('📤 To upload to Google Drive in Colab, use:');
  console.log(`\nfrom google.colab import files\nfiles.download("${ZIP_PATH}")`);
}

const batches = parseInt(process.argv[2]) || 1;
const epochs = parseInt(process.argv[3]) || 100;

train(batches, epochs).catch(err => {
  console.error('💥 Training failed:', err);
  process.exit(1);
});
