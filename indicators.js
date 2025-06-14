// indicators.js

/**
 * Calculate EMA (Exponential Moving Average)
 * @param {Array} candles - array of candles with 'close' prices
 * @param {number} period - number of periods (e.g., 20)
 * @returns {Array} EMA values for each candle starting from period-1 index
 */
function calculateEMA(candles, period) {
  const k = 2 / (period + 1);
  const emaArray = [];

  // First EMA is just SMA of first period closes
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let ema = sum / period;
  emaArray[period - 1] = ema;

  // Calculate EMA for rest
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    emaArray[i] = ema;
  }

  return emaArray;
}

/**
 * Calculate RSI (Relative Strength Index)
 * @param {Array} candles - array of candles with 'close' prices
 * @param {number} period - number of periods (e.g., 7)
 * @returns {Array} RSI values for each candle starting from period index
 */
function calculateRSI(candles, period) {
  const rsiArray = [];
  let gains = 0;
  let losses = 0;

  // Calculate initial average gain and loss
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsiArray[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  // Calculate RSI for rest of candles
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    let gain = change > 0 ? change : 0;
    let loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArray[i] = 100 - (100 / (1 + rs));
  }

  return rsiArray;
}

/**
 * Calculate Bill Williams Fractals
 * Fractal High: middle candle's high > highs of two candles before and after
 * Fractal Low: middle candle's low < lows of two candles before and after
 * @param {Array} candles - array of candles with 'high' and 'low'
 * @returns {Object} { fractalHighs: Array, fractalLows: Array } with true/false for each candle
 */
function calculateBillWilliamsFractals(candles) {
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
