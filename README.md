# Nox Vault

**Private by Design**

Nox Vault is a personal vault-based session browser, saved-link library, playlist player, image store, journal and notes app. The UI follows the supplied dark midnight/navy design with electric-blue accents and the triangular Nox Vault mark.

## Included in this build

- Firebase Email/Password owner login, with no public sign-up UI.
- Multiple password-locked vaults.
- Dashboard with recent sessions, saved items, vault status and privacy actions.
- Browser-style sessions with tabs.
- Configurable **1–5 active/preloaded tabs**.
- Least-recently-used suspension when the active limit is exceeded.
- Suspended tabs are unmounted so their iframe/video no longer remains loaded in the page.
- Save current tab to Library.
- Save all session tabs while skipping URLs already stored.
- URL normalization + SHA-256 deterministic item IDs for duplicate prevention.
- Cloud Function metadata detection for suggested title, thumbnail, tags, category suggestions, embed URL and media URL when exposed publicly by a page.
- Custom categories.
- Favorites, notes, view count and last-viewed tracking.
- Searchable Library.
- Player/playlist page that can build a queue from the whole vault, Favorites, a category, or a session.
- In-order, Next/Previous, Random and Shuffle playback controls.
- Auto-next for direct HTML5 video files when the browser can detect the `ended` event.
- Journal and Notes.
- Images page with file upload, tablet/mobile camera capture, clipboard paste and server-side image-URL importing into Firebase Storage.
- Trash + restore/permanent delete for saved Library items.
- JSON metadata backup/import.
- Configurable panic/decoy shortcut.
- Neutral `decoy.html` Knowledge Hub page.
- Automatic inactivity locking.
- Optional thumbnail blurring.
- PWA manifest + service worker so the app can be installed on supported tablets/desktops.
- GitHub Pages deployment workflow.
- Firebase Cloud Functions, Firestore rules and Storage rules.
- Local Demo Mode before Firebase is configured.

## Quick preview

If Firebase is not configured, Nox Vault automatically uses Demo Mode.

```bash
cd web
python3 -m http.server 8080
```

Visit `http://localhost:8080`.

The sample vault password is:

```text
1234
```

## Firebase setup

See **[FIREBASE_SETUP.md](./FIREBASE_SETUP.md)** for the full step-by-step setup.

The three most important things are:

1. create one Firebase Authentication owner account;
2. paste its UID into `web/js/firebase-config.js`, `firestore.rules`, `storage.rules`, and `functions/.env`;
3. deploy the Cloud Functions and rules.

## Project structure

```text
nox-vault/
├── .github/workflows/pages.yml
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── FIREBASE_SETUP.md
├── functions/
│   ├── index.js
│   ├── package.json
│   └── .env.example
└── web/
    ├── index.html
    ├── decoy.html
    ├── manifest.webmanifest
    ├── sw.js
    ├── assets/
    │   ├── nox-mark.svg
    │   └── nox-logo.svg
    ├── css/
    │   ├── app.css
    │   └── decoy.css
    └── js/
        ├── app.js
        ├── backend.js
        ├── firebase.js
        ├── firebase-config.js
        ├── firebase-config.example.js
        └── utils.js
```

## Design / storage assumptions

This version intentionally **does not use client-side encryption**, as requested. Firebase Authentication and strict owner-only Security Rules protect the data. Vault passwords are an additional application lock; they are bcrypt-hashed by Cloud Functions and never stored as plaintext in Firestore.

No personal profile fields are placed inside vault content. Records are organized under the owner's Firebase UID only to enforce Firebase access control.

## In-app browsing limitation

Nox Vault uses browser-standard iframes or direct media players. A third-party site can prohibit being displayed inside another website. If it does, JavaScript in Nox Vault cannot bypass the browser's CSP/X-Frame-Options enforcement.

The app is therefore fully functional as a vault/session/library/player system, but **whether a specific external webpage can render inside a Nox Vault tab is controlled by that external website**. Official embed URLs and direct media URLs work best.

## Remote metadata/image importing

Cloud Functions only fetch public HTTP(S) URLs. They do not bypass authentication, paywalls, access controls or anti-bot systems. Remote image imports save the actual image bytes to Firebase Storage rather than merely keeping the source link.
