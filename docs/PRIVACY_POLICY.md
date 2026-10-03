# Privacy Policy for UNO by J

**Effective Date:** October 3, 2026  
**Last Updated:** October 3, 2026

"UNO by J" is a non-commercial, free-to-play, open-source online multiplayer card game for Android. This Privacy Policy describes how data is handled when you use the UNO by J mobile application and associated server infrastructure.

---

## 1. Information We Collect

### A. Guest Account & Profile Information
* **Display Name:** When creating a guest profile, you provide a nickname/handle of your choice (e.g. "Player123"). We do not require or collect your real name, email address, phone number, or social media logins.
* **Avatar Selection:** You may select an avatar graphic ID. This is stored alongside your profile.

### B. Authentication & Passkey Credentials
* **Passkeys (FIDO2 / WebAuthn):** When using passkey authentication, all cryptographic authentication occurs on your device using public-key cryptography. Your private key never leaves your device's hardware security module. Only your public key credential ID is stored in our database to authenticate your login.
* **Tokens:** Ephemeral JSON Web Tokens (access and refresh tokens) are generated to maintain your authenticated session. On Android, refresh tokens are stored using Android Jetpack Security (`EncryptedSharedPreferences`) backed by the hardware Android Keystore.

### C. In-Game Activity & Chat Data
* **Authoritative Game Actions:** Game moves (card plays, draws, UNO calls) and turn states are processed in real-time by Cloudflare Durable Objects.
* **In-Game Chat:** Chat messages sent in rooms are transient and buffered solely for current participants in that specific room session. Messages are automatically purged upon room destruction or member abandonment.
* **Moderation Reports:** If you report a user for abusive behavior or harassment, the report category, reported user ID, room code, and optional excerpt are logged to facilitate moderation and safety enforcement.

### D. Device and Technical Information
* **We DO NOT collect:** Advertising IDs (AAID), GPS location, contacts, sensor data, device serial numbers, or telephony identifiers.
* **Network Logs:** Server requests transmit standard HTTP/WSS headers (such as IP address and user-agent string) solely as necessary to establish encrypted network connections and enforce rate limiting against denial-of-service abuse.

---

## 2. How We Use Information

Information is used strictly to:
1. Match players in public or private game rooms.
2. Synchronize game state, turns, and card plays authoritatively across connected devices.
3. Protect users against abuse, spam, and harassment via user blocking and rate limiting.
4. Prevent unauthorized access or denial-of-service attacks against free-tier infrastructure.

---

## 3. Third-Party Services, Ads, and Trackers

* **No Advertisements:** "UNO by J" contains zero advertisements, commercial trackers, or ad-network SDKs (no AdMob, Unity, AppLovin, etc.).
* **No Analytics SDKs:** We do not embed commercial analytics or tracking suites (no Google Analytics for Firebase, Adjust, AppsFlyer, or Facebook SDK).
* **Infrastructure Provider:** All server operations are hosted on Cloudflare Workers, Durable Objects, and D1 under Cloudflare's privacy and data protection agreements.

---

## 4. Data Security

* **Encryption in Transit:** 100% of data between the Android client and the server is encrypted using TLS 1.3 / HTTPS and WSS (WebSocket Secure).
* **Hardware-Backed Storage:** Tokens and cryptographic seeds on Android devices are stored in `EncryptedSharedPreferences`, utilizing the Android Keystore system.
* **Sanitized State:** Opponents' card hands are never transmitted across the network, mitigating data leakage and ensuring cheat-proof gameplay.

---

## 5. Children's Privacy

"UNO by J" is suitable for a general audience (Content Rating: Everyone / PEGI 3). The app does not request or knowingly collect personally identifiable information from children under the age of 13 (or under 16 in the European Economic Area). If you believe a child has provided personally identifiable information, please contact us for immediate deletion.

---

## 6. Data Retention & Your Rights

* **Session Termination:** Tapping "Log Out" within the app immediately clears all local credentials, tokens, and active sessions from your device.
* **Ephemeral Cleanup:** Inactive rooms and transient game states are automatically garbage-collected and pruned after game completion or inactivity timeouts.
* **Account Deletion Request:** You may request complete erasure of your guest identifier or passkey credential by submitting a request via our GitHub repository or contact email.

---

## 7. Contact Us

If you have questions, feedback, or data requests regarding this Privacy Policy, please contact:
* **Project Repository:** https://github.com/jubayer-alif/uno-by-j
* **Issue Tracker:** https://github.com/jubayer-alif/uno-by-j/issues
* **Developer Email:** support@uno-by-j.local
