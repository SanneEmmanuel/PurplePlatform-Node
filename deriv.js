const WebSocket = require('ws');
const DerivAPI = require('@deriv/deriv-api');

// Replace with your actual app_id
const app_id = '1089'; // Use your own app_id from Deriv

// Create a new WebSocket connection
const connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${app_id}`);
const api = new DerivAPI({ connection });

async function initialize() {
    try {
        // Wait for the connection to open
        await api.connect();

        // Example: Ping the server to check connectivity
        const pingResponse = await api.basic.ping();
        console.log('Ping response:', pingResponse);

        // Example: Get the website status
        const status = await api.websiteStatus();
        console.log('Website status:', status);

        // Example: Get active symbols
        const activeSymbols = await api.activeSymbols({ product_type: 'basic' });
        console.log('Active symbols:', activeSymbols);

        // Example: Subscribe to tick data for a symbol
        const tick = await api.ticks.subscribe({ symbol: 'frxEURUSD' });
        console.log('Tick data:', tick);

        // Example: Create a new contract
        const contract = await api.contracts.proposal({
            symbol: 'frxEURUSD',
            amount: 1,
            basis: 'stake',
            contract_type: 'CALL',
            currency: 'USD',
            duration: 5,
            duration_unit: 'm',
            symbol_type: 'forex',
        });
        console.log('Contract proposal:', contract);

        // Example: Authorize with an API token
        const authorization = await api.authorize({ api_token: 'your_api_token' });
        console.log('Authorization:', authorization);

        // Example: Get account balance
        const balance = await api.balance();
        console.log('Account balance:', balance);

        // Example: Get profit table
        const profitTable = await api.profitTable({
            contract_type: ['CALL'],
            profit_table: 1,
        });
        console.log('Profit table:', profitTable);

        // Example: Create a P2P advert
        const p2pAdvert = await api.p2pAdvertCreate({
            amount: 100,
            contact_info: 'contact@example.com',
            description: 'Selling EUR',
            local_currency: 'USD',
            max_order_amount: 500,
            min_order_amount: 10,
            p2p_advert_create: 1,
            payment_info: 'Bank transfer',
            rate: 1.1,
            rate_type: 'fixed',
            type: 'sell',
        });
        console.log('P2P advert created:', p2pAdvert);

    } catch (error) {
        console.error('Error initializing API:', error);
    }
}

// Initialize the API
initialize();
