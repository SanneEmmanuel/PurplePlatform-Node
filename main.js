const express = require('express');
const path = require('path');

const deriv = require('./deriv');         // Your deriv.js exports candles, openContracts, closedContracts
const indicators = require('./indicators'); // Your indicators.js exports calculation functions

const app = express();
const PORT = process.env.PORT || 3000;

// Serve frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Helper: gather and prepare chart data
function getChartData() {
  // Get candles, active trades, and closed trades from deriv.js
  const candles = deriv.candles || [];
  
  // Convert openContracts Map to array for frontend
  const activeTrades = deriv.openContracts
    ? Array.from(deriv.openContracts.values())
    : [];

  // Closed trades array
  const closedTrades = deriv.closedContracts || [];

  // Calculate indicators using indicators.js functions
  const ema20 = indicators.calculateEMA(candles, 20);
  const rsi7 = indicators.calculateRSI(candles, 7);
  const fractals = indicators.calculateBillWilliamsFractals(candles);

  return {
    candles,
    activeTrades,
    closedTrades,
    indicators: {
      ema20,
      rsi7,
      fractalHighs: fractals.fractalHighs,
      fractalLows: fractals.fractalLows,
    },
  };
}

// Endpoint: provide chart data to frontend
app.get('/api/chart-data', (req, res) => {
  try {
    const data = getChartData();
    res.json(data);
  } catch (error) {
    console.error('Error in /api/chart-data:', error);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`[✔️] Server running at http://localhost:${PORT}`);
});
