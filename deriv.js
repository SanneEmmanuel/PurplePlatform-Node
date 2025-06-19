// deriv.js (Fully Fixed & Enhanced)
// PurpleBot by Sanne Karibo

const WebSocket = require('ws');
const fs = require('fs').promises;
require('dotenv').config();

const DEFAULT_SYMBOL = 'stpRNG';
const DEFAULT_GRANULARITY = 60;
const DEFAULT_COUNT = 100;
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;
const TMP_PATH = '/tmp';

const GRANULARITY = parseInt(process.env.GRANULARITY) || DEFAULT_GRANULARITY;
const COUNT = parseInt(process.env.CANDLE_COUNT) || DEFAULT_COUNT;

let runtimeConfig = {
  SYMBOL: process.env.SYMBOL || DEFAULT_SYMBOL,
  API_TOKEN: process.env.DERIV_API_TOKEN || ''
};

function setRuntimeConfig(key, value) {
  console.log(`[⚙️] Setting ${key} = ${value}`);
  runtimeConfig[key] = value;
}

function getSymbol() {
  console.log(`[ℹ️] Getting current symbol: ${runtimeConfig.SYMBOL}`);
  return runtimeConfig.SYMBOL;
}

function getToken() {
  console.log(`[🔑] Getting current API token`);
  return runtimeConfig.API_TOKEN;
}

let candles = [];
const openContracts = new Map();
const closedContracts = new Map();
let availableSymbols = [];
let symbolDetails = [];
let accountBalance = null;
let accountInfo = {};
let onInvalidSymbol = null;

let connection = null;
let retries = 0;
let isConnecting = false;
let msgId = 1;
const callbacks = new Map();

async function saveToFile(filename, data) {
  console.log(`[💾] Attempting to save ${filename}...`);
  try {
    await fs.writeFile(`${TMP_PATH}/${filename}`, JSON.stringify(data, null, 2));
    console.log(`[💾] Saved ${filename}`);
  } catch (err) {
    console.error(`[❌] Failed to save ${filename}:`, err.message);
  }
}

async function loadFromFile(filename) {
  console.log(`[📂] Attempting to load ${filename}...`);
  try {
    const content = await fs.readFile(`${TMP_PATH}/${filename}`);
    console.log(`[📂] Loaded ${filename}`);
    return JSON.parse(content);
  } catch {
    console.log(`[📂] No cache found for ${filename}`);
    return null;
  }
}

function waitForSocketReady(timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (connection?.readyState === 1) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('WebSocket not ready'));
      setTimeout(check, 100);
    };
    check();
  });
}

function send(payload, cb) {
  payload.req_id = msgId++;
  if (cb) callbacks.set(payload.req_id, cb);
  console.log(`[📤] Preparing to send payload:`, payload);

  if (connection?.readyState === WebSocket.OPEN) {
    connection.send(JSON.stringify(payload));
    console.log(`[📤] Payload sent.`);
  } else {
    console.warn('[⚠️] WebSocket not ready, delaying send...');
    waitForSocketReady()
      .then(() => {
        connection.send(JSON.stringify(payload));
        console.log(`[📤] Delayed payload sent.`);
      })
      .catch((err) => {
        console.error('[❌] Failed to send payload:', err.message);
      });
  }
}

function createConnection() {
  console.log('[🌐] Creating WebSocket connection...');
  connection = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

  connection.on('open', () => {
    console.log('[✅] WebSocket connection is now open');
  });

  connection.on('message', handleMessage);

  connection.on('error', (err) => {
    console.error('[❌] WebSocket error:', err.message);
  });

  connection.on('close', () => {
    console.warn('[🔌] WebSocket closed. Reconnecting...');
    connect();
  });
}

async function connect() {
  console.log('[🔌] Attempting connection...');
  if (isConnecting) return;
  isConnecting = true;

  try {
    createConnection();

    await new Promise((resolve, reject) => {
      connection.on('open', resolve);
      connection.on('error', reject);
    });

    await authorize();
    console.log('[🔑] Authorized successfully');

    const loadedSymbols = await loadFromFile('symbols.json');
    if (loadedSymbols) {
      availableSymbols = loadedSymbols;
    } else {
      await loadSymbols();
      await saveToFile('symbols.json', availableSymbols);
    }

    if (!availableSymbols.includes(getSymbol())) {
      console.warn(`[⚠️] SYMBOL '${getSymbol()}' is invalid. Falling back to '${DEFAULT_SYMBOL}'`);
      setRuntimeConfig('SYMBOL', DEFAULT_SYMBOL);
      if (typeof onInvalidSymbol === 'function') onInvalidSymbol(availableSymbols);
    } else {
      console.log(`[✅] SYMBOL '${getSymbol()}' is valid.`);
    }

    const loadedCandles = await loadFromFile('candles.json');
    if (loadedCandles?.length) {
      candles = loadedCandles;
      console.log(`[📊] Loaded ${candles.length} candles from cache`);
    } else {
      await fetchInitialCandles();
      if (candles?.length) await saveToFile('candles.json', candles);
    }

    streamBalance();
    retries = 0;
  } catch (err) {
    console.error(`[❌] Connection error: ${err.message}`);
    retries++;
    if (retries <= MAX_RETRIES) {
      console.log(`[🔁] Retrying in ${RETRY_DELAY / 1000}s... (${retries}/${MAX_RETRIES})`);
      setTimeout(connect, RETRY_DELAY);
    }
  } finally {
    isConnecting = false;
  }
}

function handleMessage(message) {
  const data = JSON.parse(message);
  console.log(`[📩] Received message:`, data);
  if (data.req_id && callbacks.has(data.req_id)) {
    const cb = callbacks.get(data.req_id);
    callbacks.delete(data.req_id);
    cb(data);
  }

  switch (data.msg_type) {
    case 'authorize':
      const auth = data.authorize;
      accountInfo = {
        loginid: auth.loginid,
        currency: auth.currency,
        is_virtual: auth.is_virtual,
        email: auth.email,
        fullname: auth.fullname || ''
      };
      console.log(`[👤] Logged in as ${auth.loginid}`);
      break;

    case 'balance':
      accountBalance = data.balance.balance;
      console.log(`[💰] Balance: $${accountBalance.toFixed(2)}`);
      break;

    case 'candles':
      candles = data.candles;
      console.log(`[📊] Received ${candles.length} candles from API`);
      saveToFile('candles.json', candles);
      break;

    case 'ohlc':
      candles.push(data.ohlc);
      if (candles.length > COUNT) candles.shift();
      saveToFile('candles.json', candles);
      break;

    case 'active_symbols':
      symbolDetails = data.active_symbols;
      availableSymbols = symbolDetails.map(s => s.symbol);
      break;

    case 'buy':
      trackContract(data.buy.contract_id);
      break;

    case 'open_contract':
      const contract = data.open_contract;
      if (contract.is_sold) {
        openContracts.delete(contract.contract_id);
        closedContracts.set(contract.contract_id, contract);
      } else {
        openContracts.set(contract.contract_id, contract);
      }
      break;
  }
}

function authorize() {
  console.log('[🔐] Authorizing...');
  return new Promise((resolve, reject) => {
    const token = getToken();
    if (!token) return reject(new Error('Missing API token'));
    send({ authorize: token }, (data) => {
      if (data.error) reject(new Error(data.error.message));
      else resolve(data);
    });
  });
}

function loadSymbols() {
  console.log('[📃] Loading available symbols...');
  return new Promise((resolve) => {
    send({ active_symbols: 'brief', product_type: 'basic' }, (data) => {
      symbolDetails = data.active_symbols;
      availableSymbols = symbolDetails.map(s => s.symbol);
      resolve();
    });
  });
}

function fetchInitialCandles() {
  console.log('[📥] Fetching initial candles...');
  const end = Math.floor(Date.now() / 1000);
  const start = end - (COUNT * GRANULARITY);
  return new Promise((resolve, reject) => {
    send({
      ticks_history: getSymbol(),
      style: 'candles',
      granularity: GRANULARITY,
      start,
      end
    }, (data) => {
      if (data.error) return reject(new Error(data.error.message));
      candles = data.candles;
      console.log(`[📥] Fetched ${candles.length} candles.`);
      resolve();
    });
  });
}

function streamBalance() {
  console.log('[📶] Subscribing to balance updates...');
  send({ balance: 1, subscribe: 1 });
}

function requestTradeProposal(contractType, amount, duration, durationUnit = 'm') {
  console.log(`[📝] Requesting trade proposal: ${contractType}, $${amount}, ${duration}${durationUnit}`);
  return new Promise((resolve) => {
    send({
      proposal: 1,
      symbol: getSymbol(),
      contract_type: contractType,
      amount,
      basis: 'stake',
      currency: 'USD',
      duration,
      duration_unit: durationUnit,
      subscribe: 1
    }, resolve);
  });
}

function buyContract(proposalId, price) {
  console.log(`[🛒] Buying contract: ID=${proposalId}, Price=$${price}`);
  send({ buy: 1, price, proposal_id: proposalId });
}

function trackContract(contractId) {
  console.log(`[📈] Tracking contract ID: ${contractId}`);
  send({ open_contract: 1, contract_id: contractId, subscribe: 1 });
}

function disconnect() {
  if (connection && connection.readyState === WebSocket.OPEN) {
    connection.close(1000, 'Client disconnect');
    console.log('[🔌] Disconnected from Deriv WebSocket');
  }
}

async function reconnectWithNewSymbol(symbol) {
  console.log(`[🔄] Reconnecting with new symbol: ${symbol}`);
  setRuntimeConfig('SYMBOL', symbol);
  disconnect();
  connect();
}

async function reconnectWithNewToken(token) {
  console.log(`[🔄] Reconnecting with new token`);
  setRuntimeConfig('API_TOKEN', token);
  disconnect();
  connect();
}

async function getCurrentPrice() {
  try {
    console.log(`[🔍] getCurrentPrice → Symbol: ${getSymbol()}`);
    await waitForSocketReady();
    return new Promise((resolve, reject) => {
      send({ ticks: getSymbol() }, (data) => {
        if (data.error) {
          console.error('[❌] getCurrentPrice error:', data.error);
          return reject(new Error(data.error.message));
        }
        console.log('[📈] Current price data:', data);
        resolve(data.tick.quote);
      });
    });
  } catch (err) {
    console.error('[❌] getCurrentPrice failed:', err.message);
    throw err;
  }
}

async function getLast100Ticks() {
  try {
    console.log(`[🔍] getLast100Ticks → Symbol: ${getSymbol()}`);
    await waitForSocketReady();
    return new Promise((resolve, reject) => {
      send({ ticks_history: getSymbol(), count: 100, end: 'latest', style: 'ticks' }, (data) => {
        if (data.error) {
          console.error('[❌] getLast100Ticks error:', data.error);
          return reject(new Error(data.error.message));
        }
        console.log('[📊] Last 100 ticks:', data);
        resolve(data.history?.prices || []);
      });
    });
  } catch (err) {
    console.error('[❌] getLast100Ticks failed:', err.message);
    throw err;
  }
}

async function getTicksForTraining(count) {
  try {
    console.log(`[🔍] getTicksForTraining → Symbol: ${getSymbol()}, Count: ${count}`);
    await waitForSocketReady();
    if (count < 1 || count > 10000) throw new Error('Count must be between 1 and 10000');
    return new Promise((resolve, reject) => {
      send({ ticks_history: getSymbol(), count, end: 'latest', style: 'ticks' }, (data) => {
        if (data.error) {
          console.error('[❌] getTicksForTraining error:', data.error);
          return reject(new Error(data.error.message));
        }
        console.log('[📉] Training ticks:', data);
        resolve(data.history?.prices || []);
      });
    });
  } catch (err) {
    console.error('[❌] getTicksForTraining failed:', err.message);
    throw err;
  }
}

process.on('SIGINT', () => {
  disconnect();
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
  getSymbolDetails: () => symbolDetails,
  getCurrentSymbol: getSymbol,
  getAccountInfo: () => accountInfo,
  setOnInvalidSymbol: (cb) => (onInvalidSymbol = cb),
  reconnectWithNewSymbol,
  reconnectWithNewToken,
  getCurrentPrice,
  getLast100Ticks,
  getTicksForTraining
};
