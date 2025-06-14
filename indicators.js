// indicators.js

function calculateEMA(data, period = 20) {
    const k = 2 / (period + 1);
    const emaArray = [];

    let ema = data.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
    emaArray[period - 1] = ema;

    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
        emaArray[i] = ema;
    }

    return emaArray;
}

function calculateRSI(data, period = 7) {
    const rsiArray = [];

    let gains = 0, losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = data[i] - data[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsiArray[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < data.length; i++) {
        const change = data[i] - data[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        const rs = avgLoss === 0 ? 0 : avgGain / avgLoss;
        rsiArray[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    }

    return rsiArray;
}

/**
 * Bill Williams Fractals (for 1-minute or any timeframe)
 * @param {Array} candles - [{ high, low, ... }]
 * @returns {Array} - [{ up: bool, down: bool }]
 */
function calculateFractals(candles) {
    const len = candles.length;
    const result = Array(len).fill(null).map(() => ({ up: false, down: false }));

    for (let i = 2; i < len - 2; i++) {
        const h = candles.map(c => c.high);
        const l = candles.map(c => c.low);

        const isUpFractal =
            h[i] > h[i - 1] &&
            h[i] > h[i - 2] &&
            h[i] > h[i + 1] &&
            h[i] > h[i + 2];

        const isDownFractal =
            l[i] < l[i - 1] &&
            l[i] < l[i - 2] &&
            l[i] < l[i + 1] &&
            l[i] < l[i + 2];

        result[i] = {
            up: isUpFractal,
            down: isDownFractal
        };
    }

    return result;
}

module.exports = {
    calculateEMA,
    calculateRSI,
    calculateFractals
};
