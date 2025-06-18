const WebSocket = require('ws');
require('dotenv').config();

const DEFAULT_SYMBOL = 'stpRNG';
const DEFAULT_GRANULARITY = 60;
const DEFAULT_COUNT = 100;
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

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

function send(payload, cb) {
  payload.req_id = msgId++;
  if (cb) callbacks.set(payload.req_id, cb);
  if (connection?.readyState === 1) {
    connection.send(JSON.stringify(payload));
  }
}

function createConnection() {
  connection = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
  connection.on('message', handleMessage);
  connection.on('error', console.error);
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
    console.log('[✅] Authorized');
    await loadSymbols();

    if (!availableSymbols.includes(getSymbol())) {
      console.warn(`[⚠️] SYMBOL '${getSymbol()}' is invalid. Falling back to '${DEFAULT_SYMBOL}'`);
      setRuntimeConfig('SYMBOL', DEFAULT_SYMBOL);
      if (typeof onInvalidSymbol === 'function') onInvalidSymbol(availableSymbols);
    } else {
      console.log(`[✅] SYMBOL '${getSymbol()}' is valid.`);
    }

    await fetchInitialCandles();
    streamCandleUpdates();
    streamBalance();
    retries = 0;
  } catch (err) {
    console.error(`[❌] Connection error: ${err.message}`);
    retries++;
    if (retries <= MAX_RETRIES) {
      console.log(`[🔁] Retrying to connect in ${RETRY_DELAY / 1000}s... (${retries}/${MAX_RETRIES})`);
      setTimeout(connect, RETRY_DELAY);
    } else {
      console.error('[🛑] Max retries reached. Could not connect to Deriv API.');
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
      console.log(`[👤] Logged in as ${auth.loginid} (${auth.is_virtual ? 'Demo' : 'Real'})`);
      break;

    case 'balance':
      accountBalance = data.balance.balance;
      console.log(`[💰] Balance: $${accountBalance.toFixed(2)}`);
      break;

    case 'candles':
      candles = data.candles;
      break;

    case 'ohlc':
      candles.push(data.ohlc);
      if (candles.length > COUNT) candles.shift();
      break;

    case 'active_symbols':
      symbolDetails = data.active_symbols;
      availableSymbols = symbolDetails.map(s => s.symbol);
      console.log('[📃] Available Symbols:', availableSymbols.join(', '));
      break;

    case 'buy':
      const contractId = data.buy.contract_id;
      const contractType = data.buy.contract_type;
      console.log(`[📥] TRADE ENTERED: ${contractType} | Contract ID: ${contractId}`);
      trackContract(contractId);
      break;

    case 'open_contract':
      const contract = data.open_contract;
      if (contract.is_sold) {
        openContracts.delete(contract.contract_id);
        closedContracts.set(contract.contract_id, contract);
        console.log('[📕] Contract closed:', contract.contract_id);
      } else {
        openContracts.set(contract.contract_id, contract);
        console.log('[📗] Contract updated:', contract.contract_id);
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
    send({ active_symbols: 'brief', product_type: 'basic' }, () => resolve());
  });
}

function fetchInitialCandles() {
  return new Promise((resolve) => {
    send({ candles: getSymbol(), count: COUNT, granularity: GRANULARITY }, () => resolve());
  });
}

function streamCandleUpdates() {
  send({
    ticks_history: getSymbol(),
    style: 'candles',
    granularity: GRANULARITY,
    subscribe: 1
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
  console.log(`[📨] Sending BUY order → Proposal ID: ${proposalId}, Price: $${price}`);
  send({ buy: 1, price, proposal_id: proposalId });
}

function trackContract(contractId) {
  send({ open_contract: 1, contract_id: contractId, subscribe: 1 });
}

function disconnect() {
  if (connection) connection.close();
  console.log('[🔌] Disconnected from Deriv WebSocket');
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

process.on('SIGINT', () => {
  console.log('\n[🛑] Shutting down...');
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
  reconnectWithNewToken
};
