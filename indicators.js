// indicators.js (Safe & Patched)

function calculateEMA(candles, period) {
  if (!Array.isArray(candles) || candles.length < period) return [];

  const k = 2 / (period + 1);
  const emaArray = [];

  let sum = 0;
  for (let i = 0; i < period; i++) {
    if (!candles[i] || typeof candles[i].close !== 'number') return [];
    sum += candles[i].close;
  }

  let ema = sum / period;
  emaArray[period - 1] = ema;

  for (let i = period; i < candles.length; i++) {
    const close = candles[i]?.close;
    if (typeof close !== 'number') continue;
    ema = close * k + ema * (1 - k);
    emaArray[i] = ema;
  }

  return emaArray;
}

function calculateRSI(candles, period) {
  if (!Array.isArray(candles) || candles.length <= period) return [];

  const rsiArray = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    if (!candles[i] || !candles[i - 1]) return [];
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsiArray[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < candles.length; i++) {
    if (!candles[i] || !candles[i - 1]) continue;
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArray[i] = 100 - (100 / (1 + rs));
  }

  return rsiArray;
}

function calculateBillWilliamsFractals(candles) {
  if (!Array.isArray(candles) || candles.length < 5) return { fractalHighs: [], fractalLows: [] };

  const fractalHighs = new Array(candles.length).fill(false);
  const fractalLows = new Array(candles.length).fill(false);

  for (let i = 2; i < candles.length - 2; i++) {
    const high = candles[i].high;
    if (
      high > candles[i - 1].high &&
      high > candles[i - 2].high &&
      high > candles[i + 1].high &&
      high > candles[i + 2].high
    ) {
      fractalHighs[i] = true;
    }

    const low = candles[i].low;
    if (
      low < candles[i - 1].low &&
      low < candles[i - 2].low &&
      low < candles[i + 1].low &&
      low < candles[i + 2].low
    ) {
      fractalLows[i] = true;
    }
  }

  return { fractalHighs, fractalLows };
}

module.exports = {
  calculateEMA,
  calculateRSI,
  calculateBillWilliamsFractals,
};
