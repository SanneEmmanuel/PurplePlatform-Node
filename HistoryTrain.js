// HistoryTrain.js - Cleaned by Dr. Sanne Karibo
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import dotenv from 'dotenv';
dotenv.config();

import { trainWithTicks } from './engine/Libra3.js';
import { getTicksForTraining } from './engine/deriv.js';

const ZIP_SRC = '/tmp/model/hunter';
const ZIP_DEST = './downloads/LibraModel.zip';

async function zipModel() {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(ZIP_DEST);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`✅ Zipped: ${archive.pointer()} bytes at ${ZIP_DEST}`);
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(ZIP_SRC, false);
    archive.finalize();
  });
}

async function train(batchCount = 1, epochs = 50) {
  const totalTicks = batchCount * 300;
  console.log(`🎯 Fetching ${totalTicks} ticks...`);
  const { ticks } = await getTicksForTraining(totalTicks);
  if (!ticks?.length || ticks.length < 300) throw new Error('❌ Not enough ticks');
  
  await trainWithTicks(ticks, epochs);
  fs.mkdirSync('./downloads', { recursive: true });
  await zipModel();
  console.log('🏁 Training complete. Model ready for download.');
}

const batches = parseInt(process.argv[2]) || 1;
const epochs = parseInt(process.argv[3]) || 50;
train(batches, epochs).catch(err => {
  console.error('💥 Training failed:', err);
  process.exit(1);
});
