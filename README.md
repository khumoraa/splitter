# Splitter

Splitter is a mobile app for splitting restaurant and shop bills between friends. Photograph a receipt (or type it in), say who had what, and Splitter works out each person's share to the cent, shows who owes whom, and keeps a record of who has already settled up.

> **Splitter does not process payments and does not hold money.** It only records debts and lets people mark them as settled after paying each other in cash or by bank transfer outside the app. Statements it generates are for personal record-keeping and are not payment or tax documents.

## Features

- **Receipt scanning**: camera with a framing guide or a photo from the gallery. Recognition runs on the server (Google Gemini) with a per-user quota, a cache for repeated photos and idempotent requests. The result is checked against the printed total, and every line can be edited before splitting.
- **Manual entry**: an equal alternative to scanning, with no AI and no quota. It uses the same review screen (tax, tip and discount as an amount or %, and a check against the receipt total).
- **Splitting**: split an item equally or by units between participants. Amounts are integer minor units per currency, so nothing is lost to rounding and zero-decimal currencies such as JPY and UZS are handled correctly.
- **Friends and groups**:
  - search people by username or ID;
  - friend requests, including cancelling a request you sent;
  - groups with roles, invitations that the invitee must accept, ownership transfer, and invite links and QR codes.
- **Payment tracking**:
  - every split creates debts to the person who paid;
  - debtors mark "I paid" and the payer confirms or rejects it;
  - partial payments, forgiving a debt, and reminders sent through the share sheet;
  - an append-only activity log;
  - per-currency summaries ("owed to you" / "you owe");
  - PDF settlement statements.
- **History** of past bills with their payment status.
- **Profile and settings**: avatar, name, email and password changes, data export, account deletion, light, dark or system theme, and a default currency.
- **Languages**: English, Japanese and Uzbek, with a parity check that every key exists in all three.

## Tech stack

| Part | Technology |
|---|---|
| Mobile app | Expo SDK 57 (React Native 0.86), expo-router (native stack), TypeScript, Tamagui, zustand, react-i18next, zod, react-native-reanimated, expo-camera, expo-image-manipulator, expo-print, expo-blur / expo-glass-effect |
| Backend | Node.js 22, Express 5, TypeScript (ts-node), Prisma 6, PostgreSQL, JWT, zod, Google Gemini REST API |
| Tests | Node's built-in test runner: pure unit tests in both projects, and backend integration tests against a real server and a separate test database |

## Repository layout

```
.
├── splitter-backend-main/    REST API (Express + Prisma + PostgreSQL)
│   ├── prisma/               schema and reversible migrations (each with down.sql)
│   ├── src/routes/           auth, users, friends, groups, sessions (bills, scan), obligations (payments)
│   ├── src/services/         receipt scanning, account deletion, payment tracking
│   ├── src/utils/            pure, unit-tested helpers (money, search, quotas, ...)
│   └── test/                 integration tests
├── splitter-frontend-main/   Expo app
│   ├── app/                  screens (expo-router)
│   └── src/features/…        feature modules (auth, scan, receipt, friends, groups, payments, profile)
├── docs/                     design specs and "what's new"
├── INTEGRATION_REPORT.md     detailed change and verification log (Russian)
├── AUDIT_REPORT.md           initial audit (Russian)
└── start-all.sh / stop-all.sh  local helpers (they assume the author's local setup; read them before use)
```

## Running locally

### Requirements
- Node.js 22 and npm
- PostgreSQL 14+ (local install or the `postgres` service in `splitter-backend-main/docker-compose.yml`)
- The **Expo Go** app on your phone, with the phone and the computer on the same Wi-Fi network
- An Expo account (free), see the iOS note below
- Optional: a Google Gemini API key for receipt scanning. Without it, scanning answers "unavailable" and manual entry still works.

### 1. Backend
```bash
cd splitter-backend-main
cp .env.example .env        # then fill in DATABASE_URL, JWT_SECRET and optionally GEMINI_API_KEY
npm install
npx prisma migrate deploy   # creates the tables
npm start                   # http://0.0.0.0:3001, Swagger UI at /api-docs
```
Tests:
```bash
npm test                                    # unit tests
npm run test:db && npm run test:integration # integration tests (use a separate "splitter_test" database)
```

### 2. Frontend
```bash
cd splitter-frontend-main
cp .env.example .env        # EXPO_PUBLIC_API_URL=http://<your computer's LAN IP>:3001
npm install
npx expo login              # once; see the iOS note
npm run dev:lan             # writes your current LAN IP into .env and starts Expo (scan the QR code with the phone)
```
`npm run dev:lan` only updates the `EXPO_PUBLIC_API_URL` line. On macOS you can find the IP with `ipconfig getifaddr en0`. Tests: `npm test`, `npm run check:i18n`, `npm run lint`.

### Expo Go on iOS: sign in to the same account
On iOS, Expo Go only opens projects served by a signed-in Expo CLI.
1. Sign in to the **same Expo account** in the CLI (`npx expo login`; check with `npx expo whoami`) and in the Expo Go app on the iPhone.
2. Do **not** start Expo with `--offline` or `EXPO_OFFLINE=1`. Offline mode cannot sign the manifest, and Expo Go on iOS refuses to load it.

Android does not need this.

## Configuration
Every setting is documented in `splitter-backend-main/.env.example` and `splitter-frontend-main/.env.example`. This includes:
- scan quotas: `SCAN_LIMIT_DAILY`, `SCAN_LIMIT_MONTHLY`;
- the Gemini model: `GEMINI_MODEL_PARSE`;
- rate limits;
- avatar storage: Cloudflare R2, or local disk when R2 is not configured.

Real `.env` files are git-ignored. Never commit them.

## License
The backend (`splitter-backend-main`) is released under the MIT License (see `splitter-backend-main/LICENSE`, © 2025 saidojp). The rest of the repository has no separate license file yet, so ask the repository owner before reusing it.
