// deriv.js - Stable Deriv WebSocket API Client
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

let conn = null, isConnecting = false, isAuthorized = false, retries = 0, msgId = 1;
let candles = [], openContracts = new Map(), closedContracts = new Map();
let accountBalance = null, accountInfo = {}, availableSymbols = [], symbolDetails = [];
let contractSpecs = {}, callbacks = new Map(), onInvalidSymbol = null;

// Utils
const save = (f, d) => fs.writeFile(`${TMP}/${f}`, JSON.stringify(d, null, 2));
const load = async f => {
  try { return JSON.parse(await fs.readFile(`${TMP}/${f}`)); } catch { return null; }
};
export const waitReady = (t = 10000) => new Promise((res, rej) => {
  const start = Date.now();
  const check = () => {
    if (conn?.readyState === 1 && isAuthorized) return res();
    if (Date.now() - start > t) return rej('Socket authorization timeout');
    setTimeout(check, 100);
  };
  check();
});

async function send(payload, cb) {
  payload.req_id = msgId++;
  if (cb) callbacks.set(payload.req_id, cb);
  try { await waitReady(); conn.send(JSON.stringify(payload)); }
  catch (e) { console.error('[❌] Send failed:', e.message); }
}

function setRuntimeConfig(k, v) { cfg[k] = v; }
function getSymbol() { return cfg.SYMBOL; }
function getToken() { return cfg.API_TOKEN; }

function createConnection() {
  conn = new WebSocket(WS_URL);
  conn.on('open', () => console.log('[🌐] Connected to Deriv'));
  conn.on('message', msg => handleMessage(JSON.parse(msg)));
  conn.on('error', e => console.error('[❌] WebSocket error:', e.message));
  conn.on('close', () => {
    console.warn('[⚠️] Socket closed');
    isAuthorized = false;
    reconnect(); // auto reconnect
  });
}

async function connect() {
  if (isConnecting || conn?.readyState === 1) return;
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
    else await fetchCandles();

    streamBalance();
    retries = 0;
  } catch (err) {
    console.error('[❌] Connection failed:', err);
    if (++retries <= 5) setTimeout(connect, 3000);
  } finally {
    isConnecting = false;
  }
}

function reconnect() {
  if (conn) {
    conn.removeAllListeners();
    conn.terminate();
  }
  connect();
}

function handleMessage(data) {
  if (data.req_id && callbacks.has(data.req_id)) {
    callbacks.get(data.req_id)(data);
    callbacks.delete(data.req_id);
  }

  const t = data.msg_type;
  if (t === 'authorize') {
    if (data.error) return console.error('[❌] Auth error:', data.error.message);
    accountInfo = data.authorize;
    isAuthorized = true;
    console.log('[✅] Authorized as', accountInfo.loginid);
  }
  if (t === 'balance') accountBalance = data.balance.balance;
  if (t === 'candles') candles = data.candles, save('candles.json', candles);
  if (t === 'ohlc') {
    candles.push(data.ohlc);
    if (candles.length > COUNT) candles.shift();
    save('candles.json', candles);
  }
  if (t === 'active_symbols') {
    symbolDetails = data.active_symbols;
    availableSymbols = symbolDetails.map(s => s.symbol);
  }
  if (t === 'buy') trackContract(data.buy.contract_id);
  if (t === 'open_contract') {
    const c = data.open_contract;
    (c.is_sold ? closedContracts : openContracts).set(c.contract_id, c);
    if (c.is_sold) openContracts.delete(c.contract_id);
  }
}

const authorize = () => new Promise((res, rej) => {
  const token = getToken();
  if (!token) return rej('No API token provided');
  send({ authorize: token }, data => {
    if (data.error) return rej(data.error.message);
    isAuthorized = true;
    res(data);
  });
});

const ensureAuth = () => { if (!isAuthorized) throw 'Unauthorized'; };

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
      save('candles.json', candles);
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

const buyContract = (proposal_id, price) => {
  ensureAuth();
  send({ buy: 1, price, proposal_id });
};

const trackContract = id => send({ open_contract: 1, contract_id: id, subscribe: 1 });

function disconnect() {
  if (conn?.readyState === 1) conn.close(1000, 'Client disconnect');
}

async function reconnectWithNewSymbol(symbol) {
  setRuntimeConfig('SYMBOL', symbol);
  reconnect();
}

async function reconnectWithNewToken(token) {
  setRuntimeConfig('API_TOKEN', token);
  reconnect();
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

// Startup
connect();

// ✅ Exported API
export {
  requestContractProposal,
  buyContract,
  getCurrentPrice,
  getLast100Ticks,
  getTicksForTraining,
  reconnectWithNewSymbol,
  reconnectWithNewToken,
  getAvailableContracts,
  disconnect
};
export const isDerivReady = () => conn?.readyState === 1 && isAuthorized;
export const getAccountBalance = () => accountBalance;
export const getAvailableSymbols = () => availableSymbols;
export const getSymbolDetails = () => symbolDetails;
export const getCurrentSymbol = () => getSymbol();
export const getAccountInfo = () => accountInfo;
export const setOnInvalidSymbol = cb => (onInvalidSymbol = cb);
export { candles, openContracts, closedContracts };
