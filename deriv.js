// deriv.mjs - Cleaned & Modular (ESM)
import WebSocket from 'ws';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';
dotenv.config();

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
  runtimeConfig[key] = value;
}

function getSymbol() {
  return runtimeConfig.SYMBOL;
}

function getToken() {
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
  try {
    await fs.writeFile(`${TMP_PATH}/${filename}`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[❌] Failed to save ${filename}:`, err.message);
  }
}

async function loadFromFile(filename) {
  try {
    const content = await fs.readFile(`${TMP_PATH}/${filename}`);
    return JSON.parse(content);
  } catch {
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

  const dispatch = () => {
    if (connection?.readyState === WebSocket.OPEN) {
      connection.send(JSON.stringify(payload));
    } else {
      waitForSocketReady().then(() => {
        connection.send(JSON.stringify(payload));
      }).catch((err) => {
        console.error('[❌] Failed to send payload:', err.message);
      });
    }
  };

  dispatch();
}

function createConnection() {
  connection = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');

  connection.on('open', () => {});
  connection.on('message', handleMessage);
  connection.on('error', (err) => {
    console.error('[❌] WebSocket error:', err.message);
  });
  connection.on('close', () => {
    connect();
  });
}

async function connect() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    createConnection();

    await new Promise((resolve, reject) => {
      connection.on('open', resolve);
      connection.on('error', reject);
    });

    await authorize();

    const loadedSymbols = await loadFromFile('symbols.json');
    if (loadedSymbols) {
      availableSymbols = loadedSymbols;
    } else {
      await loadSymbols();
      await saveToFile('symbols.json', availableSymbols);
    }

    if (!availableSymbols.includes(getSymbol())) {
      setRuntimeConfig('SYMBOL', DEFAULT_SYMBOL);
      if (typeof onInvalidSymbol === 'function') onInvalidSymbol(availableSymbols);
    }

    const loadedCandles = await loadFromFile('candles.json');
    if (loadedCandles?.length) {
      candles = loadedCandles;
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
      setTimeout(connect, RETRY_DELAY);
    }
  } finally {
    isConnecting = false;
  }
}

function handleMessage(message) {
  const data = JSON.parse(message);
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
      break;

    case 'balance':
      accountBalance = data.balance.balance;
      break;

    case 'candles':
      candles = data.candles;
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
  return new Promise((resolve) => {
    send({ active_symbols: 'brief', product_type: 'basic' }, (data) => {
      symbolDetails = data.active_symbols;
      availableSymbols = symbolDetails.map(s => s.symbol);
      resolve();
    });
  });
}

function fetchInitialCandles() {
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
      resolve();
    });
  });
}

function streamBalance() {
  send({ balance: 1, subscribe: 1 });
}

function requestTradeProposal(contractType, amount, duration, durationUnit = 'm') {
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
  send({ buy: 1, price, proposal_id: proposalId });
}

function trackContract(contractId) {
  send({ open_contract: 1, contract_id: contractId, subscribe: 1 });
}

function disconnect() {
  if (connection && connection.readyState === WebSocket.OPEN) {
    connection.close(1000, 'Client disconnect');
  }
}

async function reconnectWithNewSymbol(symbol) {
  setRuntimeConfig('SYMBOL', symbol);
  disconnect();
  connect();
}

async function reconnectWithNewToken(token) {
  setRuntimeConfig('API_TOKEN', token);
  disconnect();
  connect();
}

async function getCurrentPrice() {
  await waitForSocketReady();
  return new Promise((resolve, reject) => {
    send({ ticks: getSymbol() }, (data) => {
      if (data.error) return reject(new Error(data.error.message));
      resolve(data.tick.quote);
    });
  });
}

async function getLast100Ticks() {
  await waitForSocketReady();
  return new Promise((resolve, reject) => {
    send({ ticks_history: getSymbol(), count: 100, end: 'latest', style: 'ticks' }, (data) => {
      if (data.error) return reject(new Error(data.error.message));
      resolve(data.history?.prices || []);
    });
  });
}

async function getTicksForTraining(count) {
  await waitForSocketReady();
  if (count < 1 || count > 10000) throw new Error('Count must be between 1 and 10000');
  return new Promise((resolve, reject) => {
    send({ ticks_history: getSymbol(), count, end: 'latest', style: 'ticks' }, (data) => {
      if (data.error) return reject(new Error(data.error.message));
      resolve(data.history?.prices || []);
    });
  });
}

process.on('SIGINT', () => {
  disconnect();
  process.exit();
});

connect();

// ✅ Export all async functions
export {
  requestTradeProposal,
  buyContract,
  getCurrentPrice,
  getLast100Ticks,
  getTicksForTraining,
  reconnectWithNewSymbol,
  reconnectWithNewToken
};

// ✅ Export useful accessors
export const getAccountBalance = () => accountBalance;
export const getAvailableSymbols = () => availableSymbols;
export const getSymbolDetails = () => symbolDetails;
export const getCurrentSymbol = () => getSymbol();
export const getAccountInfo = () => accountInfo;
export const setOnInvalidSymbol = (cb) => (onInvalidSymbol = cb);

// ✅ Export state
export { candles, openContracts, closedContracts };
