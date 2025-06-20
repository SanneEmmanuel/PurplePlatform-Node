// evolver.js - Advanced AI Evolution Engine
// Trains the Shadow model using historical ticks + echo sequences in 300-tick batches
// Logs progress to TensorBoard and promotes the model if accuracy improves >15%

import tf from '@tensorflow/tfjs-node';
import { getEchoes } from '../fb';
import deriv from '../deriv';
import {
  generateSynthetic,
  trainModel,
  compareModels,
  saveSparseWeights
} from './libra';
/**
 * Split data into overlapping batches of fixed size.
 * @param {Array} data - Input tick data
 * @param {number} size - Size of each batch
 * @returns {Array[]} - Batches
 */
function batchTicks(data, size = 300) {
  const batches = [];
  for (let i = 0; i <= data.length - size; i += 10) {
    batches.push(data.slice(i, i + size));
  }
  return batches;
}

/**
 * evolveModels() - Trains a Shadow model on both Echo Sequences and historical tick batches.
 * If accuracy exceeds Hunter model by >15%, promotes Shadow to Hunter.
 * @param {number} totalTicks - Number of historical ticks to fetch
 * @param {string} regime - Optional regime filter (e.g., 'volatile', 'trending')
 */
async function evolveModels(totalTicks = 5000, regime = 'volatile') {
  console.log(`[🧠] Starting model evolution using ${totalTicks} historical ticks...`);

  // 🔁 1. Load Echo Sequences (mistake memories)
  const echoSequences = await getEchoes(regime);
  console.log(`[📥] Loaded ${echoSequences.length} echo sequences from regime: ${regime}`);

  // 📊 2. Load historical ticks from Deriv
  const rawTicks = await deriv.getTicksForTraining(totalTicks);
  const tickBatches = batchTicks(rawTicks, 300);
  console.log(`[📊] Split ${rawTicks.length} ticks into ${tickBatches.length} batches of 300`);

  // 🧬 3. Synthesize training set from echoes and history
  const combinedData = [...echoSequences, ...tickBatches];
  const syntheticSet = generateSynthetic(combinedData);
  console.log(`[🧪] Generated ${syntheticSet.length} synthetic sequences for training`);

  // 🧾 4. Setup TensorBoard logging
  const logDir = `logs/train_${Date.now()}`;
  const tensorBoardCallback = tf.node.tensorBoard(logDir);

  // 🏋️‍♀️ 5. Train Shadow model with logs
  const shadowModel = await trainModel(syntheticSet, [tensorBoardCallback]);
  console.log(`[✅] Training complete. TensorBoard logs saved to ${logDir}`);

  // 📊 6. Evaluate vs current Hunter
  const improvement = await compareModels(shadowModel, 'hunter');
  console.log(`[📈] Accuracy improvement over Hunter: ${improvement.toFixed(2)}%`);

  // 👑 7. Promote if qualified
  if (improvement > 15) {
    console.log('[🚀] Shadow outperforms Hunter. Promoting...');
    await saveSparseWeights(shadowModel, 'hunter');
  } else {
    console.log('[🪶] No promotion. Shadow accuracy insufficient.');
  }
}

// CLI support
if (require.main === module) {
  const tickArg = parseInt(process.argv[2]) || 5000;
  const regimeArg = process.argv[3] || 'volatile';
  evolveModels(tickArg, regimeArg).catch(err => console.error('[❌] Evolution error:', err));
}

module.exports = { evolveModels };
