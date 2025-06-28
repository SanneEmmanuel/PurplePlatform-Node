// trainLibraModel.js
// Optimized training for Libra3.js
// Author: Dr. Sanne Karibo

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

import { trainWithTicks, downloadCurrentModel } from './engine/Libra3.js';
import { getTicksForTraining } from './engine/deriv.js';

const ZIP_PATH = './downloads/LibraModel.zip';
const TMP_ZIP = '/tmp/model.zip';

async function trainAndExport(batchMultiplier = 1) {
  const tickCount = batchMultiplier * 300;
  console.log(`🧮 Requested Ticks: ${tickCount}`);

  const { ticks } = await getTicksForTraining(tickCount);
  if (!ticks || ticks.length < 300) {
    throw new Error('❌ Insufficient tick data for training');
  }

  await trainWithTicks(ticks, 50); // 50 epochs default

  console.log('📦 Preparing ZIP for download...');
  await downloadCurrentModel(TMP_ZIP);

  fs.mkdirSync('./downloads', { recursive: true });
  fs.copyFileSync(TMP_ZIP, ZIP_PATH);

  console.log(`✅ Download ready at: ${ZIP_PATH}`);
  process.exit(0);
}

const arg = parseInt(process.argv[2]) || 1;
trainAndExport(arg).catch(err => {
  console.error('[❌] Training failed:', err);
  process.exit(1);
});
