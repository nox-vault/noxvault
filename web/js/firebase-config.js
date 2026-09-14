// Replace these values with your Firebase Web App configuration.
// This configuration is safe to expose in a browser; Firebase Security Rules protect your data.
export const firebaseConfig = {
  apiKey: "AIzaSyDDwc6PADH0GXQOmowvoxqyTWQ8bhqZ1Jo",
  authDomain: "nxvlt-d69de.firebaseapp.com",
  projectId: "nxvlt-d69de",
  storageBucket: "nxvlt-d69de.firebasestorage.app",
  messagingSenderId: "780037732427",
  appId: "1:780037732427:web:beb59eb82720d6665b35ce",
  measurementId: "G-ZY0EH3NVH6"
};



// Paste the Firebase Authentication UID of the single owner account here.
// The same UID must replace YOUR_OWNER_UID in firestore.rules and storage.rules,
// and be placed in functions/.env as OWNER_UID=...
export const OWNER_UID = "YOUR_OWNER_UID";

// If true, the app runs locally using localStorage instead of Firebase.
// Useful for previewing the interface before Firebase setup.
export const FORCE_DEMO_MODE = false;
