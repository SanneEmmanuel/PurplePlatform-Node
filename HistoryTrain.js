import { getTicksForTraining } from './deriv.js';
import { trainShadowModel, getSparseWeights, loadSparseWeights, buildModel, storage } from './engine/Libra.js';
import zlib from 'zlib';

function toEchoBuffer(candles) {
  return zlib.gzipSync(JSON.stringify({
    ticks: candles.map(c => ({ open: c.open, high: c.high, low: c.low, close: c.close }))
  }));
}

async function getLargeHistoricalChunks(chunkSize = 300, total = 3000) {
  const all = await getTicksForTraining(total);
  const buffers = [];
  for (let i = 0; i < all.length; i += chunkSize) {
    const chunk = all.slice(i, i + chunkSize);
    if (chunk.length === chunkSize) buffers.push(toEchoBuffer(chunk));
  }
  return buffers;
}

async function saveSparseToFirebase(deltas) {
  const fileName = 'weights_sparse_latest.bin';
  const data = zlib.gzipSync(JSON.stringify(deltas));

  const bucket = storage.bucket(); // ✅ Admin SDK usage
  const file = bucket.file(`model/hunter/${fileName}`);

  await file.save(data, {
    metadata: {
      contentType: 'application/octet-stream'
    }
  });

  console.log('[☁️] Uploaded sparse weights to Firebase');
}

async function main() {
  console.log('[📦] Fetching history...');
  const buffers = await getLargeHistoricalChunks(300, 3000);

  const base = buildModel();
  await loadSparseWeights(base, 'hunter');

  console.log(`[🧠] Training on ${buffers.length} batches...`);
  const trained = await trainShadowModel(buffers);

  console.log('[🧬] Computing sparse deltas...');
  const deltas = await getSparseWeights(base, trained);

  await saveSparseToFirebase(deltas);
  console.log('[✅] Done – model smarter than before!');
}

main().catch(e => console.error('[❌]', e));
