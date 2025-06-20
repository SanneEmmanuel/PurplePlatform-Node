// fb.js - Firebase Interface for PurpleBot (Node.js version)

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc, collection, addDoc, getDocs } = require('firebase/firestore');
const { getStorage, ref, uploadBytes, getDownloadURL } = require('firebase/storage');

// 🔐 Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD8KI5x8uvqyvmBDxNp7kmfkz9LJeYo49Q",
  authDomain: "libra-e615f.firebaseapp.com",
  projectId: "libra-e615f",
  storageBucket: "libra-e615f.appspot.com",
  messagingSenderId: "93883554914",
  appId: "1:93883554914:web:1aa7c95dc991184bd0053b"
};

// 🚀 Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// 📤 Expose commonly used Firebase functions
module.exports = {
  app,
  db,
  storage,
  ref,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  uploadBytes,
  getDownloadURL
};
