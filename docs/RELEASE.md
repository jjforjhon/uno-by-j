# Production Release & Deployment Guide — UNO by J

This guide covers the end-to-end deployment of the Cloudflare Worker server infrastructure and the production signing and packaging of the Android client.

---

## 1. Server Deployment (Cloudflare Workers + Durable Objects + D1)

The backend runs entirely on Cloudflare's free-tier infrastructure ($0 recurring cost model).

### Prerequisites
* [Node.js 20+](https://nodejs.org/)
* Cloudflare account (free tier)
* Cloudflare Wrangler CLI (`npm install -g wrangler`)

### Step 1: Authenticate Wrangler
```bash
npx wrangler login
```

### Step 2: Provision Cloudflare D1 Database
Create the production D1 database:
```bash
npx wrangler d1 create uno-by-j-db
```
Copy the returned `database_id` into `server/wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "uno-by-j-db"
database_id = "<your-database-id-here>"
```

### Step 3: Run Database Migrations
Apply the initial schema to the remote production D1 instance:
```bash
cd server
npx wrangler d1 migrations apply uno-by-j-db --remote
```

### Step 4: Deploy Worker & Durable Objects
```bash
cd server
npm run deploy
```
*Output will provide your deployed endpoint URL:*
```
https://uno-by-j-server.<your-subdomain>.workers.dev
```

---

## 2. Android Production Signing & Packaging

### Prerequisites
* JDK 21
* Android SDK (API 34+)

### Step 1: Generate a Release Keystore
If you do not already have a release keystore, generate one using the Java `keytool` utility:

```bash
keytool -genkey -v -keystore android/release.keystore -alias uno-key -keyalg RSA -keysize 2048 -validity 10000
```
> [!IMPORTANT]
> Securely store your keystore file and passwords. Do NOT commit the keystore or password files to version control.

### Step 2: Configure Signing Properties
Copy `android/keystore.properties.example` to `android/keystore.properties`:

```properties
storeFile=release.keystore
storePassword=<YourStorePassword>
keyAlias=uno-key
keyPassword=<YourKeyPassword>
```
*(Alternatively, in CI/CD pipelines, configure the environment variables `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, and `RELEASE_KEY_PASSWORD`.)*

### Step 3: Build Android App Bundle (AAB for Google Play Store)
Google Play requires publishing via Android App Bundle (.aab):

```bash
cd android
./gradlew :app:bundleRelease
```
The signed AAB will be output to:
`android/app/build/outputs/bundle/release/app-release.aab`

### Step 4: Build Standalone Signed APK (for Sideload / GitHub Releases)
```bash
cd android
./gradlew :app:assembleRelease
```
The APK will be output to:
`android/app/build/outputs/apk/release/app-release.apk` (or `app-release-unsigned.apk` if no keystore was provided).

### Step 5: Verify APK Signing & Alignment
Verify the generated APK with `apksigner`:
```bash
$ANDROID_HOME/build-tools/34.0.0/apksigner verify --verbose android/app/build/outputs/apk/release/app-release.apk
```

---

## 3. Pre-Flight Release Checklist

Before submitting to the Google Play Console or publishing a GitHub Release:

- [x] **Server Unit & Integration Tests Green:** Run `npm test` in `server/` (117/117 passing).
- [x] **Server TypeScript Typecheck Clean:** Run `npm run typecheck` in `server/` (0 errors).
- [x] **Worker Bundle Budget Check:** Ensure worker output is < 1 MB uncompressed (current build: ~26 KiB gzipped).
- [x] **Android Unit Tests Green:** Run `./gradlew :app:testDebugUnitTest` (31/31 passing).
- [x] **R8 Minification Verified:** Run `./gradlew :app:assembleRelease` (release APK is ~1.66 MB).
- [x] **Privacy Policy Published:** Host `docs/PRIVACY_POLICY.md` on a publicly accessible URL.
- [x] **Store Listing Metadata Ready:** Content from `docs/STORE_LISTING.md` prepared for Play Console.
- [ ] **Release Keystore Provisioned:** Keystore created and backed up securely.
