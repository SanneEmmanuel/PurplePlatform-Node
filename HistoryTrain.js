// HistoryTrain.js - Smart Historical Trainer with Evolution
// Author: Dr. Sanne Karibo

import { getTicksForTraining } from '../deriv.js';
import { trainShadowModel, getSparseWeights, loadSparseWeights, buildModel, storage } from './engine/Libra.js';
import zlib from 'zlib';
import fs from 'fs/promises';
import path from 'path';

function toEchoBuffer(candles) {
  const echo = {
    ticks: candles.map(c => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }))
  };
  return zlib.gzipSync(JSON.stringify(echo));
}

async function getLargeHistoricalChunks(chunkSize = 300, total = 3000) {
  const allCandles = await getTicksForTraining(total); // assumed to return [{open, high, low, close}]
  const echoBuffers = [];

  for (let i = 0; i < allCandles.length; i += chunkSize) {
    const chunk = allCandles.slice(i, i + chunkSize);
    if (chunk.length === chunkSize) {
      echoBuffers.push(toEchoBuffer(chunk));
    }
  }

  return echoBuffers;
}

async function saveSparseToFirebase(deltas, modelType = 'hunter') {
  const fileName = `weights_sparse_latest.bin`;
  const compressed = zlib.gzipSync(JSON.stringify(deltas));
  const ref = storage.ref().child(`model/${modelType}/${fileName}`);
  await ref.put(compressed);
  console.log(`[☁️] Sparse weights uploaded to Firebase as '${fileName}'`);
}

async function main() {
  try {
    console.log('[📦] Fetching historical candle data...');
    const echoBuffers = await getLargeHistoricalChunks(300, 3000);

    const baseModel = buildModel();
    await loadSparseWeights(baseModel, 'hunter');

    console.log(`[🧠] Training on ${echoBuffers.length} echo buffers...`);
    const trainedModel = await trainShadowModel(echoBuffers);

    console.log('[🧬] Comparing with base weights to generate sparse deltas...');
    const sparse = await getSparseWeights(baseModel, trainedModel);

    await saveSparseToFirebase(sparse, 'hunter');

    console.log('[✅] Model improved and saved. Ready for smarter predictions.');
  } catch (err) {
    console.error('[❌] Training failed:', err.message);
  }
}

main();
