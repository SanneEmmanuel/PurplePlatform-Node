// HistoryTrain.js - Dr. Sanne Karibo (Google Drive Save Edition)
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import dotenv from 'dotenv';
dotenv.config();

import { trainWithTicks, downloadCurrentModel } from './engine/Libra3.js';
import { getTicksForTraining, waitReady } from './deriv.js';

const ZIP_PATH = './downloads/LibraModel.zip';

async function train(batchCount = 1, epochs = 100) {
  const totalTicks = batchCount * 300;
  console.log('Preparing Deriv...');
await waitReady()
  console.log(`🎯 Fetching ${totalTicks} ticks...`);
  const { ticks } = await getTicksForTraining(totalTicks);

  if (!ticks?.length || ticks.length < 300) throw new Error('❌ Not enough ticks');

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
const epochs = parseInt(process.argv[3]) || 50;

train(batches, epochs).catch(err => {
  console.error('💥 Training failed:', err);
  process.exit(1);
});
