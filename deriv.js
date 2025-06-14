const WebSocket = require('ws');
require('dotenv').config();

const API_TOKEN = process.env.DERIV_API_TOKEN || 'your_api_token_here';

// Config
const SYMBOL = 'R_100';
const GRANULARITY = 60; // 1 minute
const COUNT = 100;

let ws;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 10000; // 10 seconds max delay

// Store open contracts by contract_id
const openContracts = new Map();

function connectWebSocket() {
    ws = new WebSocket('wss://ws.derivws.com/websockets/v3');

    ws.on('open', () => {
        reconnectAttempts = 0;
        console.log('[✓] WebSocket connected. Sending authorization...');
        ws.send(JSON.stringify({ authorize: API_TOKEN }));
    });

    ws.on('message', (data) => {
        try {
            const response = JSON.parse(data);
            handleMessage(response);
        } catch (err) {
            console.error('[⚠️] JSON parse error:', err);
        }
    });

    ws.on('error', (err) => {
        console.error('[❗] WebSocket error:', err.message);
    });

    ws.on('close', () => {
        console.log('[🔌] WebSocket connection closed.');
        attemptReconnect();
    });
}

function attemptReconnect() {
    reconnectAttempts++;
    const delay = Math.min(MAX_RECONNECT_DELAY, 1000 * 2 ** reconnectAttempts);
    console.log(`[🔄] Attempting to reconnect in ${delay / 1000} seconds...`);

    setTimeout(() => {
        console.log('[🔁] Reconnecting now...');
        connectWebSocket();
    }, delay);
}

function handleMessage(response) {
    switch (response.msg_type) {
        case 'authorize':
            console.log('[🔐] Authorized as', response.authorize.loginid);
            requestCandles();
            requestTradeHistory();
            break;

        case 'candles':
            handleCandles(response);
            break;

        case 'proposal':
            handleProposal(response);
            break;

        case 'buy':
            handleBuy(response);
            break;

        case 'proposal_open_contract':
            handleOpenContract(response);
            break;

        case 'error':
            console.error('[❌] API Error:', response.error.message);
            break;

        default:
            console.log('[ℹ️] Unhandled message type:', response.msg_type);
    }
}

function handleCandles(response) {
    if (response.candles && response.candles.length > 0) {
        const latest = response.candles[response.candles.length - 1];
        console.log(`[📊] Received ${response.candles.length} candles for ${SYMBOL} (${GRANULARITY}s interval)`);
        console.table(response.candles.map(c => ({
            time: new Date(c.epoch * 1000).toISOString(),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume
        })));
        console.log(`[💵] Latest price (close): ${latest.close}`);
    } else {
        console.log('[⚠️] No candle data received.');
    }
}

function handleProposal(response) {
    // Trade proposal received — you can handle or pass this to your UI or logic
    console.log('[💡] Trade proposal received:', response.proposal);
}

function handleBuy(response) {
    // Buy confirmation received
    console.log('[🎉] Trade purchased:', response.buy);
    // You may want to subscribe to contract updates here by calling subscribeOpenContract(response.buy.contract_id)
}

function handleOpenContract(response) {
    if (response.proposal_open_contract) {
        const contract = response.proposal_open_contract;
        openContracts.set(contract.contract_id, contract);
        console.log('[📈] Open contract update:', contract);
    }
}

function requestCandles() {
    const request = {
        candles: SYMBOL,
        granularity: GRANULARITY,
        count: COUNT,
        subscribe: 0 // change to 1 if you want live updates
    };
    console.log(`[📨] Requesting ${COUNT} historical candles for ${SYMBOL} (${GRANULARITY}s interval)...`);
    ws.send(JSON.stringify(request));
}

// === Trade functions ===

// Request a trade proposal (price quote)
function requestTradeProposal(contractType, amount, duration, durationUnit = 'm') {
    const proposalRequest = {
        proposal: 1,
        subscribe: 1, // subscribe for proposal updates
        amount: amount,
        basis: 'stake',  // or 'payout' depending on your preference
        contract_type: contractType, // e.g. CALL, PUT
        currency: 'USD', // your account currency
        duration: duration,
        duration_unit: durationUnit,
        symbol: SYMBOL,
    };

    console.log(`[📨] Requesting trade proposal: ${contractType} ${amount} USD for ${duration}${durationUnit} on ${SYMBOL}`);
    ws.send(JSON.stringify(proposalRequest));
}

// Buy contract based on proposal id and price
function buyContract(proposalId, price) {
    const buyRequest = {
        buy: proposalId,
        price: price,
        subscribe: 1, // subscribe to contract updates
    };

    console.log(`[📨] Sending buy request for proposal ${proposalId} at price ${price}`);
    ws.send(JSON.stringify(buyRequest));
}

// Subscribe to open contract updates by contract_id
function subscribeOpenContract(contractId) {
    const subscribeRequest = {
        proposal_open_contract: contractId,
        subscribe: 1,
    };
    console.log(`[📨] Subscribing to open contract updates for contract_id: ${contractId}`);
    ws.send(JSON.stringify(subscribeRequest));
}

// Request trade history (closed contracts)
function requestTradeHistory() {
    const historyRequest = {
        proposal_open_contract: 1,
        subscribe: 0, // no live updates needed here
    };
    console.log('[📨] Requesting trade history (closed contracts)...');
    ws.send(JSON.stringify(historyRequest));
}

// Start connection
connectWebSocket();

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
    console.log('\n[🛑] Shutting down...');
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    process.exit();
});

// ===
// Now, to trade:
// - call requestTradeProposal(...) to get a proposal
// - then call buyContract(proposalId, price) with values from proposal
// - to track contract updates, call subscribeOpenContract(contractId)
// ===
