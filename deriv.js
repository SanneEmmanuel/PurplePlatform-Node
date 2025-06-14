const WebSocket = require('ws');
require('dotenv').config();

const API_TOKEN = process.env.DERIV_API_TOKEN || 'your_api_token_here';

// Config
const SYMBOL = 'R_100';
const GRANULARITY = 60; // 1 minute
const COUNT = 100;

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 10000; // 10 seconds max delay

// Data stores
let candles = [];
const openContracts = new Map();    // Active trades
const closedContracts = new Map();  // Past trades

// Connect WebSocket
function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('[ℹ️] WebSocket already connected.');
        return;
    }

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

        case 'sell':
            handleSell(response);
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
        candles = response.candles;
        const latest = candles[candles.length - 1];
        console.log(`[📊] Received ${candles.length} candles for ${SYMBOL} (${GRANULARITY}s interval)`);
        // Optionally log or process candles here
    } else {
        console.log('[⚠️] No candle data received.');
    }
}

function handleProposal(response) {
    console.log('[💡] Trade proposal received:', response.proposal);
}

function handleBuy(response) {
    console.log('[🎉] Trade purchased:', response.buy);
    subscribeOpenContract(response.buy.contract_id);
}

function handleOpenContract(response) {
    if (response.proposal_open_contract) {
        const contract = response.proposal_open_contract;

        if (contract.is_expired) {
            openContracts.delete(contract.contract_id);
            closedContracts.set(contract.contract_id, contract);
            console.log('[📉] Contract expired, moved to closedContracts:', contract.contract_id);
        } else {
            openContracts.set(contract.contract_id, contract);
            console.log('[📈] Open contract update:', contract.contract_id);
        }
    }
}

function handleSell(response) {
    console.log('[🛒] Sell response:', response.sell);
}

// Requests

function requestCandles() {
    const request = {
        candles: SYMBOL,
        granularity: GRANULARITY,
        count: COUNT,
        subscribe: 0, // 1 for live updates
    };
    console.log(`[📨] Requesting ${COUNT} historical candles for ${SYMBOL} (${GRANULARITY}s interval)...`);
    ws.send(JSON.stringify(request));
}

function requestTradeHistory() {
    const historyRequest = {
        proposal_open_contract: 1,
        subscribe: 0,
    };
    console.log('[📨] Requesting trade history (closed contracts)...');
    ws.send(JSON.stringify(historyRequest));
}

// Trading functions

function requestTradeProposal(contractType, amount, duration, durationUnit = 'm') {
    const proposalRequest = {
        proposal: 1,
        subscribe: 1,
        amount: amount,
        basis: 'stake',
        contract_type: contractType,
        currency: 'USD',
        duration: duration,
        duration_unit: durationUnit,
        symbol: SYMBOL,
    };

    console.log(`[📨] Requesting trade proposal: ${contractType} ${amount} USD for ${duration}${durationUnit} on ${SYMBOL}`);
    ws.send(JSON.stringify(proposalRequest));
}

function buyContract(proposalId, price) {
    const buyRequest = {
        buy: proposalId,
        price: price,
        subscribe: 1,
    };

    console.log(`[📨] Sending buy request for proposal ${proposalId} at price ${price}`);
    ws.send(JSON.stringify(buyRequest));
}

function subscribeOpenContract(contractId) {
    const subscribeRequest = {
        proposal_open_contract: contractId,
        subscribe: 1,
    };
    console.log(`[📨] Subscribing to open contract updates for contract_id: ${contractId}`);
    ws.send(JSON.stringify(subscribeRequest));
}

function sellContract(contractId, price) {
    if (!contractId) {
        console.error('[❗] sellContract: contractId is required');
        return;
    }
    const sellRequest = {
        sell: contractId,
        price: price,
    };
    console.log(`[📨] Sending sell request for contract ${contractId} at price ${price}`);
    ws.send(JSON.stringify(sellRequest));
}

function disconnectWebSocket() {
    if (ws) {
        console.log('[🛑] Disconnecting WebSocket...');
        ws.close();
        ws = null;
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[🛑] Shutting down...');
    disconnectWebSocket();
    process.exit();
});

module.exports = {
    connectWebSocket,
    disconnectWebSocket,
    candles,
    openContracts,
    closedContracts,
    requestTradeProposal,
    buyContract,
    subscribeOpenContract,
    sellContract,
};

// Optionally start connection automatically
connectWebSocket();
