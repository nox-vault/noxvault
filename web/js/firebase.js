import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy, limit, where, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import { firebaseConfig, FORCE_DEMO_MODE } from './firebase-config.js';

const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_') && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith('YOUR_');
export const demoMode = FORCE_DEMO_MODE || !configured;

let app=null,auth=null,db=null,storage=null,functions=null;
if(!demoMode){
  app=initializeApp(firebaseConfig);
  auth=getAuth(app);
  db=getFirestore(app);
  storage=getStorage(app);
  functions=getFunctions(app);
}
export {app,auth,db,storage,functions,signInWithEmailAndPassword,signOut,onAuthStateChanged,collection,doc,getDoc,getDocs,setDoc,addDoc,updateDoc,deleteDoc,query,orderBy,limit,where,serverTimestamp,writeBatch,storageRef,uploadBytes,getDownloadURL,deleteObject,httpsCallable};
