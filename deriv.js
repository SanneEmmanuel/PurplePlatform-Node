// deriv.js - Modular Deriv WebSocket API Client
import WebSocket from 'ws';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const TMP = '/tmp';
const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
const GRAN = +process.env.GRANULARITY || 60;
const COUNT = +process.env.CANDLE_COUNT || 100;
const DEF_SYMBOL = 'stpRNG';

let cfg = {
  SYMBOL: process.env.SYMBOL || DEF_SYMBOL,
  API_TOKEN: process.env.DERIV_API_TOKEN || ''
};

let candles = [], openContracts = new Map(), closedContracts = new Map();
let accountBalance = null, accountInfo = {}, isAuthorized = false;
let availableSymbols = [], symbolDetails = [], contractSpecs = {};
let onInvalidSymbol, conn = null, isConnecting = false, retries = 0, msgId = 1;
const callbacks = new Map();

// Helpers
const save = (f, d) => fs.writeFile(`${TMP}/${f}`, JSON.stringify(d, null, 2));
const load = async f => {
  try { return JSON.parse(await fs.readFile(`${TMP}/${f}`)); } catch { return null; }
};
const waitReady = (t = 10000) => new Promise((res, rej) => {
  const s = Date.now(); const check = () =>
    conn?.readyState === 1 ? res() : Date.now() - s > t ? rej('Socket timeout') : setTimeout(check, 100);
  check();
});
async function send(payload, cb) {
  payload.req_id = msgId++;
  if (cb) callbacks.set(payload.req_id, cb);
  try { await waitReady(); conn.send(JSON.stringify(payload)); }
  catch (e) { console.error('[❌] Send error:', e); }
}

const setRuntimeConfig = (k, v) => (cfg[k] = v);
const getSymbol = () => cfg.SYMBOL;
const getToken = () => cfg.API_TOKEN;

function createConnection() {
  conn = new WebSocket(WS_URL);
  conn.on('message', msg => handleMessage(JSON.parse(msg)));
  conn.on('error', e => console.error('[❌] WebSocket error:', e.message));
  conn.on('close', () => { isAuthorized = false; connect(); });
}

async function connect() {
  if (isConnecting) return;
  isConnecting = true;
  try {
    console.log('[🌐] Connecting...');
    createConnection();
    await waitReady();
    console.log('[🔐] Token:', getToken());
    await authorize();

    const loaded = await load('symbols.json');
    availableSymbols = loaded || (await loadSymbols(), await save('symbols.json', availableSymbols), availableSymbols);

    if (!availableSymbols.includes(getSymbol())) {
      setRuntimeConfig('SYMBOL', DEF_SYMBOL);
      onInvalidSymbol?.(availableSymbols);
    }

    const cached = await load('candles.json');
    if (cached?.length) candles = cached;
    else await fetchCandles(), await save('candles.json', candles);

    streamBalance();
    retries = 0;
  } catch (err) {
    console.error('[❌] Connect failed:', err);
    if (++retries <= 5) setTimeout(connect, 3000);
  } finally {
    isConnecting = false;
  }
}

function handleMessage(data) {
  if (data.req_id && callbacks.has(data.req_id)) {
    callbacks.get(data.req_id)(data);
    callbacks.delete(data.req_id);
  }
  const m = data.msg_type;
  if (m === 'authorize') {
    if (data.error || !data.authorize) return isAuthorized = false;
    accountInfo = data.authorize;
    isAuthorized = true;
    console.log('[✅] Authorized as', accountInfo.loginid);
  }
  if (m === 'balance') accountBalance = data.balance.balance;
  if (m === 'candles') candles = data.candles, save('candles.json', candles);
  if (m === 'ohlc') {
    candles.push(data.ohlc);
    if (candles.length > COUNT) candles.shift();
    save('candles.json', candles);
  }
  if (m === 'active_symbols') {
    symbolDetails = data.active_symbols;
    availableSymbols = symbolDetails.map(s => s.symbol);
  }
  if (m === 'buy') trackContract(data.buy.contract_id);
  if (m === 'open_contract') {
    const c = data.open_contract;
    (c.is_sold ? closedContracts : openContracts).set(c.contract_id, c);
    if (c.is_sold) openContracts.delete(c.contract_id);
  }
}

const authorize = () => new Promise((res, rej) => {
  const token = getToken();
  if (!token) return rej('No token');
  send({ authorize: token }, data => {
    if (data.error) return rej(data.error.message);
    isAuthorized = true;
    res(data);
  });
});

const ensureAuth = () => { if (!isAuthorized) throw 'Not authorized'; };

function loadSymbols() {
  return new Promise(resolve => {
    send({ active_symbols: 'brief', product_type: 'basic' }, d => {
      symbolDetails = d.active_symbols;
      availableSymbols = symbolDetails.map(s => s.symbol);
      resolve();
    });
  });
}

function fetchCandles() {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (COUNT * GRAN);
  return new Promise((res, rej) => {
    send({ ticks_history: getSymbol(), style: 'candles', granularity: GRAN, start, end }, d => {
      if (d.error) return rej(d.error.message);
      candles = d.candles;
      res();
    });
  });
}

const streamBalance = () => send({ balance: 1, subscribe: 1 });

async function requestContractProposal(type, amount, duration, unit = 'm', basis = 'stake', barrier = null, digit = null) {
  ensureAuth();
  const payload = {
    proposal: 1,
    symbol: getSymbol(),
    contract_type: type,
    amount, basis,
    currency: 'USD',
    duration, duration_unit: unit,
    subscribe: 1
  };
  if (barrier) payload.barrier = barrier;
  if (digit !== null) payload.barrier = digit;
  return new Promise(res => send(payload, res));
}

async function getAvailableContracts(symbol = getSymbol()) {
  ensureAuth();
  return new Promise((resolve, reject) => {
    send({ contracts_for: symbol, currency: 'USD' }, data => {
      if (data.error) return reject(data.error.message);
      const types = [];
      for (const m of data.contracts_for.available || []) {
        for (const s of m.submarkets || []) {
          for (const i of s.instruments || []) {
            for (const c of i.contracts || []) {
              types.push({
                type: c.contract_type,
                name: c.contract_category_display,
                barrier: c.barrier_category !== 'none',
                digit: c.barrier_category === 'digit'
              });
            }
          }
        }
      }
      resolve(types);
    });
  });
}

const requestCALLProposal = (...args) => requestContractProposal('CALL', ...args);
const requestPUTProposal = (...args) => requestContractProposal('PUT', ...args);
const requestHIGHERProposal = (...args) => requestContractProposal('HIGHER', ...args);
const requestLOWERProposal = (...args) => requestContractProposal('LOWER', ...args);

const buyContract = (proposal_id, price) => {
  ensureAuth();
  send({ buy: 1, price, proposal_id });
};

const trackContract = id => send({ open_contract: 1, contract_id: id, subscribe: 1 });

function disconnect() {
  if (conn?.readyState === 1) conn.close(1000, 'Bye');
}

async function reconnectWithNewSymbol(sym) {
  setRuntimeConfig('SYMBOL', sym);
  disconnect();
  await connect();
}

async function reconnectWithNewToken(token) {
  setRuntimeConfig('API_TOKEN', token);
  disconnect();
  await connect();
}

const getCurrentPrice = async () => {
  ensureAuth(); await waitReady();
  return new Promise((res, rej) => {
    send({ ticks: getSymbol() }, d => d.error ? rej(d.error.message) : res(d.tick.quote));
  });
};

const getLast100Ticks = async () => {
  ensureAuth(); await waitReady();
  return new Promise((res, rej) => {
    send({ ticks_history: getSymbol(), count: 100, end: 'latest', style: 'ticks' },
      d => d.error ? rej(d.error.message) : res(d.history?.prices || []));
  });
};

const getTicksForTraining = async count => {
  ensureAuth(); await waitReady();
  if (count < 1) throw 'Count < 1';
  const all = [], chunk = 10000;
  let remaining = count, end = Math.floor(Date.now() / 1000);
  while (remaining > 0) {
    const now = Math.min(remaining, chunk), start = end - now;
    const chunkData = await new Promise((res, rej) => {
      send({ ticks_history: getSymbol(), start, end, style: 'ticks' },
        d => d.error ? rej(d.error.message) : res(d.history?.prices || []));
    });
    if (!chunkData.length) break;
    all.unshift(...chunkData);
    remaining -= chunkData.length;
    end = start;
  }
  return all.slice(-count);
};

process.on('SIGINT', () => { disconnect(); process.exit(); });
connect();

// ✅ Export API
export {
  requestContractProposal,
  buyContract,
  getCurrentPrice,
  getLast100Ticks,
  getTicksForTraining,
  reconnectWithNewSymbol,
  reconnectWithNewToken,
  getAvailableContracts,
  requestCALLProposal,
  requestPUTProposal,
  requestHIGHERProposal,
  requestLOWERProposal,
  disconnect
};

export const getAccountBalance = () => accountBalance;
export const getAvailableSymbols = () => availableSymbols;
export const getSymbolDetails = () => symbolDetails;
export const getCurrentSymbol = () => getSymbol();
export const getAccountInfo = () => accountInfo;
export const setOnInvalidSymbol = cb => (onInvalidSymbol = cb);
export { candles, openContracts, closedContracts };
