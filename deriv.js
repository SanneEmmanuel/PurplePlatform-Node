// deriv-api-wrapper.js
const { DerivAPI } = require('deriv-api');
const WebSocket = require('ws');
require('dotenv').config();

const DEFAULT_SYMBOL = 'R_100';
const DEFAULT_GRANULARITY = 60;
const DEFAULT_COUNT = 100;
const API_TOKEN = process.env.DERIV_API_TOKEN;

let SYMBOL = process.env.SYMBOL || DEFAULT_SYMBOL;
const GRANULARITY = parseInt(process.env.GRANULARITY) || DEFAULT_GRANULARITY;
const COUNT = parseInt(process.env.CANDLE_COUNT) || DEFAULT_COUNT;

let candles = [];
const openContracts = new Map();
const closedContracts = new Map();
let availableSymbols = [];
let accountBalance = null;
let onInvalidSymbol = null;

let connection = null;
let api = null;

function createConnection() {
  connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=1089`);
  api = new DerivAPI({ connection });
}

async function connect() {
  createConnection();

  try {
    await api.account.authorize(API_TOKEN);
    console.log('[✅] Authorized:', (await api.account.getAccount()).loginid);

    await loadSymbols();
    validateSymbol();
    await fetchInitialCandles();
    streamCandleUpdates();
    streamBalance();
  } catch (err) {
    console.error('[❌] Connection error:', err.message);
  }
}

async function loadSymbols() {
  const res = await api.basic.activeSymbols({ brief: true });
  availableSymbols = res.map(s => s.symbol);
}

function validateSymbol() {
  if (!availableSymbols.includes(SYMBOL)) {
    console.error(`[❌] SYMBOL '${SYMBOL}' is invalid.`);
    if (typeof onInvalidSymbol === 'function') onInvalidSymbol(availableSymbols);
    disconnect();
    return;
  }
  console.log(`[✅] SYMBOL '${SYMBOL}' is valid.`);
}

async function fetchInitialCandles() {
  const data = await api.ticks.candles({ symbol: SYMBOL, granularity: GRANULARITY, count: COUNT });
  candles = [...data];
}

async function streamCandleUpdates() {
  const stream = await api.ticks.subscribeCandles({ symbol: SYMBOL, granularity: GRANULARITY });
  stream.onUpdate((candle) => {
    candles.push(candle);
    if (candles.length > COUNT) candles.shift();
  });
}

async function streamBalance() {
  const stream = await api.account.subscribeBalance();
  stream.onUpdate((balance) => {
    accountBalance = balance.balance;
    console.log(`[💰] Balance: $${accountBalance.toFixed(2)}`);
  });
}

async function requestTradeProposal(contractType, amount, duration, durationUnit = 'm') {
  return await api.contract.proposal({
    symbol: SYMBOL,
    contract_type: contractType,
    amount,
    basis: 'stake',
    currency: 'USD',
    duration,
    duration_unit: durationUnit,
    subscribe: 1
  });
}

async function buyContract(proposalId, price) {
  const response = await api.contract.buy({ proposal_id: proposalId, price });
  const contractId = response.buy.contract_id;
  console.log('[🛒] Bought contract:', contractId);
  trackContract(contractId);
}

async function trackContract(contractId) {
  const stream = await api.contract.subscribeOpenContract({ contract_id: contractId });
  stream.onUpdate((contract) => {
    if (contract.is_sold) {
      openContracts.delete(contract.contract_id);
      closedContracts.set(contract.contract_id, contract);
      console.log('[📕] Contract closed:', contract.contract_id);
    } else {
      openContracts.set(contract.contract_id, contract);
      console.log('[📗] Contract updated:', contract.contract_id);
    }
  });
}

async function disconnect() {
  if (api) await api.disconnect();
}

async function reconnectWithNewSymbol(newSymbol) {
  SYMBOL = newSymbol;
  await disconnect();
  connect();
}

async function reconnectWithNewToken(newToken) {
  process.env.DERIV_API_TOKEN = newToken;
  await disconnect();
  connect();
}

process.on('SIGINT', async () => {
  console.log('\n[🛑] Shutting down...');
  await disconnect();
  process.exit();
});

connect();

module.exports = {
  candles,
  openContracts,
  closedContracts,
  requestTradeProposal,
  buyContract,
  getAccountBalance: () => accountBalance,
  getAvailableSymbols: () => availableSymbols,
  getCurrentSymbol: () => SYMBOL,
  setOnInvalidSymbol: (cb) => (onInvalidSymbol = cb),
  reconnectWithNewSymbol,
  reconnectWithNewToken
};
