import { firebaseConfig, FORCE_DEMO_MODE } from './firebase-config.js?v=20260915-v8-extension';

const configured = Boolean(
  firebaseConfig?.apiKey &&
  !String(firebaseConfig.apiKey).startsWith('PASTE_') &&
  !String(firebaseConfig.apiKey).startsWith('YOUR_') &&
  firebaseConfig?.projectId &&
  !String(firebaseConfig.projectId).startsWith('YOUR_')
);

export const demoMode = Boolean(FORCE_DEMO_MODE || !configured);
export let firebaseInitError = null;

export let app = null;
export let auth = null;
export let db = null;

export let signInWithEmailAndPassword = null;
export let signOut = null;
export let onAuthStateChanged = null;

export let collection = null;
export let doc = null;
export let getDoc = null;
export let getDocs = null;
export let setDoc = null;
export let addDoc = null;
export let updateDoc = null;
export let deleteDoc = null;
export let query = null;
export let orderBy = null;
export let limit = null;
export let where = null;
export let serverTimestamp = null;
export let writeBatch = null;
export let Bytes = null;

if (!demoMode) {
  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
    ]);

    app = appSdk.initializeApp(firebaseConfig);
    auth = authSdk.getAuth(app);
    db = firestoreSdk.getFirestore(app);

    signInWithEmailAndPassword = authSdk.signInWithEmailAndPassword;
    signOut = authSdk.signOut;
    onAuthStateChanged = authSdk.onAuthStateChanged;

    collection = firestoreSdk.collection;
    doc = firestoreSdk.doc;
    getDoc = firestoreSdk.getDoc;
    getDocs = firestoreSdk.getDocs;
    setDoc = firestoreSdk.setDoc;
    addDoc = firestoreSdk.addDoc;
    updateDoc = firestoreSdk.updateDoc;
    deleteDoc = firestoreSdk.deleteDoc;
    query = firestoreSdk.query;
    orderBy = firestoreSdk.orderBy;
    limit = firestoreSdk.limit;
    where = firestoreSdk.where;
    serverTimestamp = firestoreSdk.serverTimestamp;
    writeBatch = firestoreSdk.writeBatch;
    Bytes = firestoreSdk.Bytes;
  } catch (error) {
    firebaseInitError = error;
    console.error('Nox Vault: Firebase SDK failed to initialize.', error);
  }
}
