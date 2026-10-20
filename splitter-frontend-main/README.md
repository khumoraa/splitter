# Receipt Splitter (Frontend)

Receipt splitting client built with Expo + React Native. The app relies on Expo Router, Zustand, TanStack Query, and Tamagui for navigation, state, data fetching, and UI.

## Prerequisites

- Node.js 22 (LTS; the backend requires 22 or newer). Install via nvm or nvm-windows or download from nodejs.org, then confirm with `node -v`.
- npm 9 or newer. Bundled with Node.js; verify with `npm -v`.
- Expo CLI v7 (optional). You can run Expo commands with `npx expo ...` instead of installing the CLI globally.
- Git for cloning and version control.
- Expo Go on your iOS or Android device or access to emulators and simulators.
- Platform tooling: Android Studio with SDKs and virtual devices; Xcode on macOS for iOS builds.

> If you maintain a custom `.npmrc`, install dependencies with `npm install --legacy-peer-deps` when peer resolution fails.

## Install Dependencies

```bash
git clone https://github.com/<your-org>/receipt-splitter-frontend.git
cd receipt-splitter-frontend
npm install
```

## Configure Environment Variables

Create a `.env` or `.env.local` file for runtime configuration such as API endpoints, feature flags, and secrets. Use the `EXPO_PUBLIC_` prefix for values that must be exposed to the Expo client.

To start with overrides for local development:

```bash
cp .env .env.local
```

## Run with Expo

```bash
npx expo start
```

This launches the Expo Dev Server and Metro bundler. From the interactive prompt you can:
- press `a` to open the Android emulator or a connected device,
- press `i` to open the iOS simulator (macOS only),
- scan the QR code with Expo Go to open the app on a physical device,
- press `w` to launch the web build (`expo start --web`).

Use `npx expo start --clear` to reset Metro and Expo caches if the bundle becomes unstable.


## Run on a phone (Expo Go) with the local backend

The phone must reach your computer over the network, so `localhost` does not work. Use the computer's LAN IP; the phone and the computer must be on the same Wi-Fi (or the computer on the phone's hotspot).

1. **Find the IP.** macOS: `ipconfig getifaddr en0` (try `en1` if empty). Linux: `hostname -I`. Windows: `ipconfig`, the IPv4 address of your Wi-Fi adapter.
2. **Start the backend** (PostgreSQL must be running and `splitter-backend-main/.env` filled in, see its README):
   ```bash
   cd ../splitter-backend-main && npm install && npx prisma migrate deploy && npm start
   ```
   Check it from the computer: `curl http://<IP>:3001/health` should print `{"status":"ok"}`. Open the same URL in the phone's browser to check the network path.
3. **Point the app at it and start Expo** with one command (it changes only the `EXPO_PUBLIC_API_URL` line of `.env`, then runs `expo start -c`):
   ```bash
   npm run dev:lan
   ```
   or by hand: set `EXPO_PUBLIC_API_URL=http://<IP>:3001` in `.env` and run `REACT_NATIVE_PACKAGER_HOSTNAME=<IP> npx expo start -c`.
4. Scan the QR code with Expo Go (the Expo Go version must match the SDK in `package.json`, currently SDK 54).

**If the network changes** (new Wi-Fi, hotspot, VPN, laptop reconnects) the IP changes too, and the old address stays inside the bundle. Stop Expo and run `npm run dev:lan` again; it rewrites the address and clears the Metro cache (`-c`). Restart the backend only if it stopped. `EXPO_PUBLIC_*` values are read when Metro starts, so editing `.env` alone is not enough.

Tips: `npm run dev:lan -- --no-start` only updates `.env`; `API_PORT=3002 npm run dev:lan` uses another backend port; `LAN_IP=<ip> npm run dev:lan` overrides detection. If the phone cannot open `http://<IP>:3001/health`, the Wi-Fi may isolate clients (guest network) or a firewall blocks port 3001/8081.

## Useful Scripts

- `npx expo run:android` or `npm run android` builds and runs on a connected Android device or emulator (Android Studio required).
- `npx expo run:ios` or `npm run ios` launches the iOS build on a simulator (macOS and Xcode required).
- `npx expo start --web` or `npm run web` runs the web preview.
- `npm run dev:lan` writes the current LAN IP into `EXPO_PUBLIC_API_URL` and starts Expo with a cleared cache (see above).
- `npm test` runs the unit tests, `npm run lint` runs ESLint.
- `npm run start` remains available as a shortcut for `expo start` if you prefer npm scripts.

## Platform and EAS Guidelines

1. Android: Install Android Studio, configure an AVD or enable USB debugging, then run `npx expo run:android`.
2. iOS: Install Xcode with the required simulators, then run `npx expo run:ios`.
3. EAS Build: Authenticate with `npx expo login` and trigger builds via `npx eas build` (configuration lives in `eas.json`).

## Project Structure

- `app/` – Expo Router entry points and routing-aware screens.
- `src/` – domain logic, state stores, API clients, and shared modules.
- `assets/` – static assets such as images and fonts.
- `app.json`, `eas.json` – Expo and EAS configuration.

## References and Troubleshooting

- https://docs.expo.dev/
- https://docs.expo.dev/router/introduction/
- https://reactnative.dev/docs/environment-setup
- https://tamagui.dev/docs/intro

If you hit dependency issues, make sure you are on the latest Node.js LTS, clear caches, reinstall with `npm install`, and restart with `npx expo start`. Architectural notes live in `ARCHITECTURE.md`, and delivery status is tracked in `STATUS.yaml`.
