const WebSocket = require('ws');
require('dotenv').config();

const API_TOKEN = process.env.DERIV_API_TOKEN || 'your_api_token_here';
const SYMBOL = process.env.SYMBOL;
const GRANULARITY = 60;
const COUNT = 100;

const candles = [];
const openContracts = new Map();
const closedContracts = new Map();

let ws = null;
let reconnecting = false;
let availableSymbols = [];
let onInvalidSymbol = null;
let accountBalance = null; // 💰 New: holds latest balance

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

  ws.on('error', (err) => {
    console.error('[⚠️] WebSocket Error:', err.message);
  });

  ws.on('close', () => {
    console.log('[🔌] WebSocket closed. Reconnecting...');
    if (!reconnecting) {
      reconnecting = true;
      setTimeout(connect, 3000);
    }
  });
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function handleMessage(msg) {
  switch (msg.msg_type) {
    case 'authorize':
      console.log('[🔐] Authorized as:', msg.authorize.loginid);
      requestActiveSymbols();
      requestBalance(); // 💰 New: request balance after auth
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
      handleBalance(msg); // 💰 New: handle balance updates
      break;

    case 'error':
      console.error('[❌] API Error:', msg.error.message);
      break;

    default:
      // console.log('[ℹ️] Unhandled msg_type:', msg.msg_type);
      break;
  }
}

function requestActiveSymbols() {
  send({
    active_symbols: 'brief',
    product_type: 'basic',
  });
}

function handleActiveSymbols(msg) {
  availableSymbols = msg.active_symbols.map((s) => s.symbol);

  if (!availableSymbols.includes(SYMBOL)) {
    console.error(`[❌] SYMBOL '${SYMBOL}' is invalid.`);
    if (typeof onInvalidSymbol === 'function') {
      onInvalidSymbol(availableSymbols);
    }
    ws.close();
    return;
  }

  console.log(`[✅] SYMBOL '${SYMBOL}' is valid.`);
  subscribeToCandles();
}

function subscribeToCandles() {
  send({
    candles: SYMBOL,
    granularity: GRANULARITY,
    subscribe: 1,
  });
}

function updateCandles(msg) {
  if (msg.ohlc) {
    const updated = msg.ohlc;
    candles.push(updated);
    if (candles.length > COUNT) candles.shift();
  } else if (msg.candles) {
    candles.splice(0, candles.length, ...msg.candles);
  }
}

function requestTradeProposal(contractType, amount, duration, durationUnit = 'm') {
  const proposal = {
    proposal: 1,
    subscribe: 1,
    amount,
    basis: 'stake',
    contract_type: contractType,
    currency: 'USD',
    duration,
    duration_unit: durationUnit,
    symbol: SYMBOL,
  };
  send(proposal);
}

function buyContract(proposalId, price) {
  const buy = {
    buy: proposalId,
    price,
    subscribe: 1,
  };
  send(buy);
}

function handleBuy(msg) {
  console.log('[🛒] Bought contract:', msg.buy.contract_id);
  subscribeToOpenContract(msg.buy.contract_id);
}

function subscribeToOpenContract(contractId) {
  send({
    proposal_open_contract: 1,
    contract_id: contractId,
    subscribe: 1,
  });
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

// 💰 Request balance (subscribe to balance updates)
function requestBalance() {
  send({
    balance: 1,
    subscribe: 1,
  });
}

// 💰 Handle balance updates
function handleBalance(msg) {
  if (msg.balance && typeof msg.balance.balance === 'number') {
    accountBalance = msg.balance.balance;
    console.log(`[💰] Account balance: $${accountBalance.toFixed(2)}`);
  }
}

// === Init WebSocket ===
connect();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[🛑] Shutting down...');
  if (ws) ws.close();
  process.exit();
});

// === Exports ===
module.exports = {
  candles,
  openContracts,
  closedContracts,
  requestTradeProposal,
  buyContract,
  handleProposal: null,
  setOnInvalidSymbol: (cb) => { onInvalidSymbol = cb; },
  getAvailableSymbols: () => availableSymbols,
  requestBalance, // 💰 exported
  getAccountBalance: () => accountBalance, // 💰 exported
};
