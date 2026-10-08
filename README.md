# ParcelGo

Nigerian last-mile delivery platform starter: an Expo mobile experience plus Node/Express API designed for Neon PostgreSQL, Prisma, and Redis.

## Run the mobile app

```powershell
npm install
npx expo start
```

The app includes sender creation, quote UI, parcel tracking, notifications, and a rider-mode demo. It currently uses local UI data; connect it to the API when authentication is in place.

## Run the API with Neon

```powershell
cd api
Copy-Item .env.example .env
# Set DATABASE_URL to the pooled Neon connection string and set JWT_SECRET
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

`POST /pricing/quote` returns costs in kobo. The API exposes registration/login, KYC submission and admin review, pricing, delivery creation/tracking, rider queue and availability, delivery acceptance/status updates, and persisted in-app notifications. Redis broadcasts events when `REDIS_URL` is configured.

## Mobile API configuration

Create `.env` in the project root with `EXPO_PUBLIC_API_URL=http://YOUR-LAN-IP:4000` when testing on a physical phone. `src/api.ts` provides one typed fetch client rather than placing networking logic in screens.

## Current build limitation

The local `npm` command currently points to a missing global installation (`...Roaming/npm/node_modules/npm/bin/npm-cli.js`). Repair or reinstall Node.js/npm in VS Code, then run the commands above to type-check and launch the app.
