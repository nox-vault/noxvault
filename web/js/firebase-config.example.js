// Replace these values with your Firebase Web App configuration.
// This configuration is safe to expose in a browser; Firebase Security Rules protect your data.
export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Paste the Firebase Authentication UID of the single owner account here.
// The same UID must replace YOUR_OWNER_UID in firestore.rules and storage.rules,
// and be placed in functions/.env as OWNER_UID=...
export const OWNER_UID = "YOUR_OWNER_UID";

// If true, the app runs locally using localStorage instead of Firebase.
// Useful for previewing the interface before Firebase setup.
export const FORCE_DEMO_MODE = false;
