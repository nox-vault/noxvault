# Nox Vault — Firebase Setup

Nox Vault is split into two pieces:

- `web/` — static frontend for GitHub Pages.
- `functions/` + Firebase rules — private backend for authentication, Firestore, Storage, vault password verification, page metadata lookup, and remote image importing.

The frontend contains **no public sign-up flow**. Create only your own owner account in Firebase Authentication.

## 1. Create a brand-new Firebase project

1. Sign in to the Firebase Console with the Google account you want to use for Nox Vault.
2. Create a new project, for example `nox-vault-private`.
3. Analytics is not needed for Nox Vault; you can leave it disabled.
4. In **Project settings → Your apps**, add a **Web app**.
5. Copy the Firebase configuration object.

Open `web/js/firebase-config.js` and replace:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

Keep the exact values Firebase gives you.

## 2. Create your single owner login

1. Firebase Console → **Authentication** → **Get started**.
2. Enable **Email/Password** sign-in.
3. Do **not** add public account creation to Nox Vault.
4. Authentication → **Users** → **Add user**.
5. Create your own email/password login.
6. Copy that user's Firebase **UID**.

Use the UID in all three locations below:

### `web/js/firebase-config.js`

```js
export const OWNER_UID = "PASTE_YOUR_UID_HERE";
```

### `firestore.rules`

Replace every:

```text
YOUR_OWNER_UID
```

with the UID.

### `storage.rules`

Replace every:

```text
YOUR_OWNER_UID
```

with the UID.

This makes the database/storage owner-only even if somebody discovers the GitHub Pages URL or creates another Firebase Authentication account.

## 3. Create Firestore

1. Firebase Console → **Firestore Database** → **Create database**.
2. Choose your preferred region.
3. Production mode is fine; the included rules will be deployed afterward.

Do not manually create collections. Nox Vault creates them as needed.

Data is stored under:

```text
/users/{yourUid}/settings
/users/{yourUid}/vaults/{vaultId}
/users/{yourUid}/vaults/{vaultId}/categories
/users/{yourUid}/vaults/{vaultId}/items
/users/{yourUid}/vaults/{vaultId}/sessions
/users/{yourUid}/vaults/{vaultId}/notes
/users/{yourUid}/vaults/{vaultId}/images
```

Vault password hashes are stored separately in:

```text
/vaultSecrets/{uid}_{vaultId}
```

Client rules deny all access to `vaultSecrets`; only Firebase Cloud Functions can read/write them.

## 4. Enable Firebase Storage

1. Firebase Console → **Storage** → **Get started**.
2. Select a location.
3. The supplied Storage rules only allow your owner UID to access image files under your own vault path.
4. Direct uploads are limited to images smaller than 25 MB.
5. Remote image importing through Cloud Functions is limited to 15 MB.

Nox Vault supports:

- image file uploads;
- tablet/phone camera capture;
- clipboard image paste where the browser permits it;
- copying an image from a public image URL into Firebase Storage.

## 5. Install Firebase CLI

Install Node.js 20+, then:

```bash
npm install -g firebase-tools
firebase login
```

From the root of this project:

```bash
firebase use --add
```

Choose the Firebase project you just created.

You may copy `.firebaserc.example` to `.firebaserc` and edit the project ID instead.

## 6. Configure Cloud Functions owner UID

Copy:

```text
functions/.env.example
```

to:

```text
functions/.env
```

Then edit it:

```text
OWNER_UID=PASTE_YOUR_FIREBASE_AUTH_UID_HERE
```

`functions/.env` is ignored by Git and should not be committed.

Install function dependencies:

```bash
cd functions
npm install
cd ..
```

Cloud Functions may require your Firebase project to have billing enabled, depending on Firebase's current requirements.

## 7. Deploy rules and Cloud Functions

From the project root:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

The backend functions included are:

- `createVault`
- `verifyVaultPassword`
- `setVaultPassword`
- `deleteVault`
- `fetchPageMetadata`
- `importRemoteImage`

### Security note

`fetchPageMetadata` and `importRemoteImage` validate remote URLs and reject local/private/reserved network addresses. They also limit response sizes and redirects. This helps prevent the functions from being abused as an SSRF proxy.

## 8. Test locally

Before configuring Firebase, the app automatically runs in **Demo Mode**. The demo vault password is:

```text
1234
```

Serve the `web` folder over HTTP rather than opening the HTML file directly:

```bash
cd web
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080
```

After you fill in `firebase-config.js`, Demo Mode automatically turns off.

## 9. Publish the frontend to GitHub Pages

Create a brand-new private or public GitHub repository and upload the whole Nox Vault project.

The included workflow:

```text
.github/workflows/pages.yml
```

deploys only the contents of `web/`.

In GitHub:

1. Repository → **Settings** → **Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push to the `main` branch.
4. The workflow deploys the frontend.

Firebase API keys in `firebase-config.js` are browser configuration identifiers, not server secrets. Your actual protection comes from Firebase Authentication, Firestore Rules, Storage Rules, and the owner UID restriction.

## 10. Authorized domains

Firebase Authentication may require the GitHub Pages host to be present in Authentication → Settings → Authorized domains.

Add your GitHub Pages domain if Firebase does not add/accept it automatically, for example:

```text
YOUR_GITHUB_USERNAME.github.io
```

## What the vault password does

You specifically requested no client-side encryption. Accordingly:

- saved URLs, notes, categories, sessions and image metadata are normal Firestore data;
- uploaded images are normal Firebase Storage objects;
- Firebase owner-only authentication/rules protect access;
- each vault has an additional application password;
- that password is bcrypt-hashed by Cloud Functions and the hash is hidden from the frontend;
- locking a vault unloads active in-app pages/players and requires the vault password to reopen it.

The vault password is therefore a **second application lock**, not an encryption key.

## Third-party website limitation

Nox Vault can display:

- normal pages that permit iframe embedding;
- official embed URLs;
- direct video/media URLs supported by the browser.

A website can deliberately block iframe embedding with browser security headers such as CSP `frame-ancestors` or `X-Frame-Options`. A GitHub-hosted web app cannot override that restriction. Such URLs can still be saved, categorized, searched, placed in sessions, and used in the Player when an embeddable/direct-media URL is available.
