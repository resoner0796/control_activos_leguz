// ==========================================================
// Conexión a Firebase (SDK modular vía CDN, sin bundler)
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCYtYgvIyH1TmM1xMHQrHAsqVxgt0BWlXc",
  authDomain: "control-de-activos-becc3.firebaseapp.com",
  projectId: "control-de-activos-becc3",
  storageBucket: "control-de-activos-becc3.firebasestorage.app",
  messagingSenderId: "548788472153",
  appId: "1:548788472153:web:4960adc9a7ab014773e448",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
