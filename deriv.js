const WebSocket = require('ws');
require('dotenv').config(); // Optional: for loading API token from .env

const API_TOKEN = process.env.DERIV_API_TOKEN || 'your_api_token_here';

// WebSocket connection to Deriv
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3');

// Handle connection open
ws.on('open', () => {
    console.log('[✓] WebSocket connected. Sending authorization...');
    ws.send(JSON.stringify({ authorize: API_TOKEN }));
});

// Handle incoming messages
ws.on('message', (data) => {
    try {
        const response = JSON.parse(data);
        console.log('[📥] Message received:', response);

        switch (response.msg_type) {
            case 'authorize':
                console.log('[🔐] Authorized as', response.authorize.loginid);
                // Request account balance as example
                requestBalance();
                break;

            case 'balance':
                console.log('[💰] Balance:', response.balance);
                break;

            case 'error':
                console.error('[❌] API Error:', response.error);
                break;

            default:
                console.log('[ℹ️] Other message:', response.msg_type);
        }

    } catch (err) {
        console.error('[⚠️] JSON parse error:', err);
    }
});

// Handle errors
ws.on('error', (err) => {
    console.error('[❗] WebSocket error:', err);
});

// Handle connection close
ws.on('close', () => {
    console.log('[🔌] WebSocket connection closed.');
});

// Send a balance request
function requestBalance() {
    ws.send(JSON.stringify({
        balance: 1,
        subscribe: 1 // Set to 0 if you want a one-time snapshot
    }));
}
