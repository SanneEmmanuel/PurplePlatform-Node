// fb.js
const { initializeApp } = require('firebase/app');
const { getDatabase } = require('firebase/database');
const { getStorage } = require('firebase/storage');

const config = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  databaseURL: process.env.FIREBASE_DB_URL
};

const app = initializeApp(config);
module.exports = {
  db: getDatabase(app),
  storage: getStorage(app)
};
