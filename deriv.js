// deriv.js
const WebSocket = require('ws');
require('dotenv').config();

const API_TOKEN = process.env.DERIV_API_TOKEN;
const SYMBOL = process.env.SYMBOL;
const GRANULARITY = 60;
const COUNT = 100;

let ws = null;
let reconnecting = false;

const candles = [];
const openContracts = new Map();
const closedContracts = new Map();
let availableSymbols = [];
let accountBalance = null;
let onInvalidSymbol = null;

function connect() {
  ws = new WebSocket('wss://ws.derivws.com/websockets/v3');

  ws.on('open', () => {
    console.log('[✅] WebSocket connected');
    send({ authorize: API_TOKEN });
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(msg);
    } catch (e) {
      console.error('[❌] JSON Parse Error:', e.message);
    }
  });

  ws.on('error', (err) => console.error('[⚠️] WebSocket Error:', err.message));
  ws.on('close', () => {
    console.log('[🔌] WebSocket closed. Reconnecting...');
    if (!reconnecting) {
      reconnecting = true;
      setTimeout(connect, 3000);
    }
  });
}

function send(data) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function handleMessage(msg) {
  switch (msg.msg_type) {
    case 'authorize':
      console.log('[🔐] Authorized:', msg.authorize.loginid);
      requestActiveSymbols();
      requestBalance();
      break;
    case 'active_symbols':
      handleActiveSymbols(msg);
      break;
    case 'candles':
    case 'ohlc':
      updateCandles(msg);
      break;
    case 'proposal':
      if (exports.handleProposal) exports.handleProposal(msg);
      break;
    case 'buy':
      handleBuy(msg);
      break;
    case 'proposal_open_contract':
      handleOpenContract(msg);
      break;
    case 'balance':
      handleBalance(msg);
      break;
    case 'error':
      console.error('[❌] API Error:', msg.error.message);
      break;
  }
}

function requestActiveSymbols() {
  send({ active_symbols: 'brief', product_type: 'basic' });
}

function handleActiveSymbols(msg) {
  availableSymbols = msg.active_symbols.map((s) => s.symbol);
  if (!availableSymbols.includes(SYMBOL)) {
    console.error(`[❌] SYMBOL '${SYMBOL}' is invalid.`);
    if (typeof onInvalidSymbol === 'function') onInvalidSymbol(availableSymbols);
    ws.close();
    return;
  }
  console.log(`[✅] SYMBOL '${SYMBOL}' is valid.`);
  subscribeToCandles();
}

function subscribeToCandles() {
  send({ candles: SYMBOL, granularity: GRANULARITY, subscribe: 1 });
}

function updateCandles(msg) {
  if (msg.ohlc) {
    candles.push(msg.ohlc);
    if (candles.length > COUNT) candles.shift();
  } else if (msg.candles) {
    candles.splice(0, candles.length, ...msg.candles);
  }
}

function requestTradeProposal(contractType, amount, duration, durationUnit = 'm') {
  send({
    proposal: 1,
    subscribe: 1,
    amount,
    basis: 'stake',
    contract_type: contractType,
    currency: 'USD',
    duration,
    duration_unit: durationUnit,
    symbol: SYMBOL,
  });
}

function buyContract(proposalId, price) {
  send({ buy: proposalId, price, subscribe: 1 });
}

function handleBuy(msg) {
  console.log('[🛒] Bought contract:', msg.buy.contract_id);
  subscribeToOpenContract(msg.buy.contract_id);
}

function subscribeToOpenContract(contractId) {
  send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
}

function handleOpenContract(msg) {
  const contract = msg.proposal_open_contract;
  if (!contract) return;
  const { contract_id, is_sold } = contract;
  if (is_sold) {
    openContracts.delete(contract_id);
    closedContracts.set(contract_id, contract);
    console.log('[📕] Contract closed:', contract_id);
  } else {
    openContracts.set(contract_id, contract);
    console.log('[📗] Contract updated:', contract_id);
  }
}

function requestBalance() {
  send({ balance: 1, subscribe: 1 });
}

function handleBalance(msg) {
  if (msg.balance?.balance) {
    accountBalance = msg.balance.balance;
    console.log(`[💰] Balance: $${accountBalance.toFixed(2)}`);
  }
}

// Start on load
connect();

process.on('SIGINT', () => {
  console.log('\n[🛑] Shutting down...');
  if (ws) ws.close();
  process.exit();
});

module.exports = {
  candles,
  openContracts,
  closedContracts,
  requestTradeProposal,
  buyContract,
  getAccountBalance: () => accountBalance,
  requestBalance,
  setOnInvalidSymbol: (cb) => (onInvalidSymbol = cb),
  getAvailableSymbols: () => availableSymbols,
  getCurrentSymbol: () => SYMBOL,
  reconnectWithNewSymbol: (newSymbol) => {
    process.env.SYMBOL = newSymbol;
    reconnecting = false;
    if (ws) ws.close();
  },
  reconnectWithNewToken: (token) => {
    process.env.DERIV_API_TOKEN = token;
    reconnecting = false;
    if (ws) ws.close();
  },
  handleProposal: null
};
