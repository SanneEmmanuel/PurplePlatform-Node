# 🟣 PurpleBot-Node

**By Sanne Karibo**
Automated trading bot for Deriv using Node.js, WebSockets, and Express
➡️ GitHub: [SanneEmmanuel/PurplePlatform-Node](https://github.com/SanneEmmanuel/PurplePlatform-Node)

---

## 🚀 Overview

PurpleBot-Node is a real-time trading bot that connects to [Deriv](https://deriv.com)'s WebSocket API. It fetches market data, analyzes conditions using technical indicators, and executes trades based on customizable logic.

---

## ⚙️ Features

* Live WebSocket integration with Deriv's API
* Real-time candle and price data
* Automated RSI/EMA-based buy/sell strategy
* Tracks active and closed trades
* REST API for bot control and data retrieval
* Frontend chart support served from `public/`

---

## 📁 Folder Structure

```
PurplePlatform-Node/
├── deriv.js             # Handles WebSocket and Deriv API integration
├── indicators.js        # Custom RSI, EMA, and Fractal calculations
├── main.js              # Express server and trade controller
├── .env                 # Environment variables (DERIV_API_TOKEN, PORT)
├── package.json         # Project configuration and dependencies
├── README.md            # Project documentation
├── public/              # Frontend assets (HTML, JS, CSS)
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── node_modules/        # Installed packages (after npm install)
```

---

## 🛠️ Setup

### 1. Clone the repository

```bash
git clone https://github.com/SanneEmmanuel/PurplePlatform-Node.git
cd PurplePlatform-Node
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the root directory:

```
DERIV_API_TOKEN=your_deriv_api_token_here
PORT=3000
```

Or you can set the API token at runtime using the `/set-api-token` endpoint.

---

## 🚀 Run Locally

```bash
npm start
```

By default, the bot is accessible at:
[http://localhost:3000](http://localhost:3000)

---

## 📡 API Endpoints

| Endpoint          | Method | Description                                  |
| ----------------- | ------ | -------------------------------------------- |
| `/api/chart-data` | GET    | Returns live candles, trades, and indicators |
| `/trade-start`    | POST   | Starts the trading logic loop                |
| `/trade-end`      | POST   | Stops the trading loop                       |
| `/set-api-token`  | POST   | Dynamically sets the Deriv API token         |

### Example: Set API token

```bash
curl -X POST http://localhost:3000/set-api-token \
  -H "Content-Type: application/json" \
  -d '{"token":"YOUR_DERIV_TOKEN"}'
```

---

## 📈 Strategy Logic

### Buy Conditions:

* RSI(7) > 55
* Price > EMA(20)
* Price > close of previous two candles

### Sell Conditions:

* RSI(7) < 45
* Price < EMA(20)
* Price < close of previous two candles

Trading logic runs every 10 seconds when active.

---

## ☁️ Deploying to Railway

1. Push your code to GitHub
2. Visit [railway.app](https://railway.app)
3. Create a new project → Deploy from GitHub
4. Add the environment variable: `DERIV_API_TOKEN`
5. Railway auto-deploys and serves your app

---

## 🧠 Technical Stack

* Node.js + Express (API server)
* WebSocket (Deriv API connection)
* dotenv (env management)
* Frontend served from `/public/` folder

---

## 🧑‍💻 Author

**Sanne Karibo**
GitHub: [@SanneEmmanuel](https://github.com/SanneEmmanuel)
Email: [sannekaribo@gmail.com](mailto:sannekaribo@gmail.com)

---

## 📜 License

This project is **not open source** for public modification.
Use is permitted for educational and personal purposes **only**.
To modify, redistribute, or integrate this code into other tools or projects,
**you must request explicit permission** from the author.
