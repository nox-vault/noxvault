import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, limit, where, serverTimestamp, writeBatch, Bytes
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, FORCE_DEMO_MODE } from './firebase-config.js';

const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE_') && !firebaseConfig.apiKey.startsWith('YOUR_')
  && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith('YOUR_');
export const demoMode = FORCE_DEMO_MODE || !configured;

let app=null,auth=null,db=null;
if(!demoMode){
  app=initializeApp(firebaseConfig);
  auth=getAuth(app);
  db=getFirestore(app);
}
export {
  app,auth,db,signInWithEmailAndPassword,signOut,onAuthStateChanged,
  collection,doc,getDoc,getDocs,setDoc,addDoc,updateDoc,deleteDoc,query,orderBy,limit,where,
  serverTimestamp,writeBatch,Bytes
};
