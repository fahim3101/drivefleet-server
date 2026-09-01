<div align="center">

# 🚗 DriveFleet — Server API

### *Stateless REST API — JWT in HTTPOnly Cookies, Marketplace Control*

<p>
  <img src="https://img.shields.io/badge/Node-18-339933?style=for-the-badge&logo=node.js" />
  <img src="https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express" />
  <img src="https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb" />
  <img src="https://img.shields.io/badge/JWT-HTTPOnly-000000?style=for-the-badge&logo=jsonwebtokens" />
  <img src="https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel" />
</p>

<p>
  <a href="https://drivefleet-client-nine.vercel.app"><img src="https://img.shields.io/badge/Client_Live-Demo-black?style=for-the-badge" /></a>
  <a href="https://drivefleet-server-orpin.vercel.app"><img src="https://img.shields.io/badge/API_Live-Running-success?style=for-the-badge" /></a>
  <a href="https://github.com/fahim3101/drivefleet-client"><img src="https://img.shields.io/badge/Frontend_Repo-Click-24292e?style=for-the-badge&logo=github" /></a>
</p>

> **🆕 Sep 2026** — Overlap check • Payment fields • Reviews • Admin full control (all cars/bookings/reviews/users) • Email (Nodemailer) • Helmet/RateLimit • Indexes • Pagination/sorting • Fallback ADMIN fr87817833@gmail.com

</div>

---

## 🧭 Overview

```
React (Vite)  ──HTTPOnly cookie──▶  Express  ──▶  MongoDB Atlas (cars, bookings, reviews)
   ▲                                  │
   └────────── JWT verify ◀────────────┘
```

Stateless, single `index.js` (Vercel serverless), MongoDB native driver, no Mongoose.

---

## 🌟 Features

| Area | Detail |
|------|--------|
| **Auth** | `POST /jwt` → 7d JWT cookie (`httpOnly, Secure, SameSite=None`), `verifyToken` gate, `onAuthStateChanged` |
| **Admin** | `ADMIN_EMAIL=fr87817833@gmail.com` whitelist, `ADMIN_PASS=admin123`, `verifyAdmin`, `POST /admin/direct-login` (Firebase bypass), fallback defaults if env missing |
| **Cars** | CRUD, `ownerEmail` enforced from token, `GET /cars` pagination/sort/search, `PUT/DELETE` owner OR admin bypass via `/admin/cars/:id` |
| **Bookings** | `POST /bookings` overlap check (409), `paymentStatus/transactionId`, `$inc bookingCount`, decrement on cancel, email mock |
| **Reviews** | `reviews` collection, `POST/GET/:carId/DELETE` (own or admin), avg calc |
| **Control** | `GET /admin/{cars,bookings,reviews,users}` + `DELETE` any + `PUT toggle` availability |
| **Security** | Helmet, RateLimit 200/15m, `escapeRegex`, `isValidObjectId`, `cors` allow-list, indexes |
| **Email** | Nodemailer — `SMTP_*` if set else `console.log [MOCK]` for booking/cancel |

---

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node 18 + Express 4 |
| DB | MongoDB Atlas native driver 4.1 + indexes (`carName text`, `carType`, `ownerEmail`, `userEmail`, `carId`, `reviews.carId`) |
| Auth | jsonwebtoken HS256 |
| Security | helmet, express-rate-limit, cookie-parser, cors |
| Email | nodemailer 9 |
| Deploy | Vercel `@vercel/node`, `vercel.json` |

---

## 📁 Structure

```
drivefleet-server/
├── index.js       # all routes/middleware (396→770 lines with admin)
├── vercel.json    # { builds: @vercel/node, routes: /(.*) -> index.js }
├── .env.example
└── package.json   # helmet, express-rate-limit, nodemailer added
```

---

## 🚀 Quick Start

```bash
git clone https://github.com/fahim3101/drivefleet-server.git
cd drivefleet-server
npm install
cp .env.example .env  # fill
npm run dev    # nodemon -> http://localhost:5000
npm start      # prod
```

Visit `/` → `DriveFleet Server is Running! v5`

---

## 🔑 Env Vars

```env
PORT=5000
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/drivefleet?retryWrites=true&w=majority
JWT_SECRET=openssl rand -base64 32
NODE_ENV=production

SMTP_HOST=smtp.gmail.com  # optional
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

ADMIN_EMAIL=fr87817833@gmail.com   # comma-separated for multiple
ADMIN_PASS=admin123
```

Fallback: if `ADMIN_*` missing, defaults to `fr87817833@gmail.com / admin123` so Vercel 500 fixed.

---

## 📡 API Reference

Base: `http://localhost:5000` or `https://drivefleet-server-orpin.vercel.app`

### Auth

| Method | Endpoint | Auth | Body | Resp |
|--------|----------|------|------|------|
| POST | `/jwt` | Public | `{email}` | `token` cookie |
| POST | `/logout` | Public | — | clear cookie |
| POST | `/admin/login` | Public | `{password}` | `adminToken` (needs prior JWT) |
| POST | `/admin/direct-login` | Public | `{email,password}` | `token+adminToken` (Firebase bypass) |
| POST | `/admin/logout` | — | — | clear admin |
| GET | `/admin/check` | 🔒 | — | `{isAdmin, hasAdminPass}` |

```bash
curl -X POST http://localhost:5000/admin/direct-login -H "Content-Type: application/json" -d '{"email":"fr87817833@gmail.com","password":"admin123"}' -c cookies.txt
```

### Cars

| Endpoint | Auth | Query/Body | Note |
|----------|------|------------|------|
| `GET /cars?search=&type=&sort=newest&page=1&limit=12` | Public | — | returns `{cars, total, page, totalPages}` |
| `GET /cars/latest` | Public | — | 6 newest |
| `GET /cars/:id` | Public | — | `isValidObjectId` |
| `GET /my-cars?email=` | 🔒 | email==JWT | own |
| `POST /cars` | 🔒 | `validateCarPayload` | `ownerEmail` forced from token |
| `PUT /cars/:id` | 🔒 | whitelist | owner only |
| `DELETE /cars/:id` | 🔒 | — | owner only |

**Admin Cars (bypass owner):**
| `GET /admin/cars?search=&page=` | 👑 | — | all |
| `DELETE /admin/cars/:id` | 👑 | — | + cleanup bookings/reviews |
| `PUT /admin/cars/:id/toggle` | 👑 | — | flip Available |

### Bookings

| Endpoint | Auth | Body |
|----------|------|------|
| `POST /bookings` | 🔒 | `carId, carName, startDate, endDate, totalPrice, paymentMethod, transactionId` → overlap 409 → `$inc` → email |
| `GET /bookings?email=` | 🔒 | own |
| `DELETE /bookings/:id` | 🔒 | own → `$inc -1` → cancel email |

**Admin:** `GET /admin/bookings` (100), `DELETE /admin/bookings/:id` (any)

### Reviews

| `POST /reviews` | 🔒 | `carId, rating 1-5, comment` |
| `GET /reviews/:carId` | Public | → `{reviews, avg, count}` |
| `DELETE /reviews/:id` | 🔒 | own |
| `GET /admin/reviews` | 👑 | all |
| `DELETE /admin/reviews/:id` | 👑 | any |

### Admin Stats

`GET /admin/stats` 👑 → `{totalCars, totalBookings, availableCars, unavailableCars, recentCars, recentBookings, carsByType, totalRevenue, monthlyBookings}`

`GET /admin/users` 👑 → `[{email, carCount, bookingCount, reviewCount, total}]` sorted desc

---

## 🗄️ Data Models

**cars**
```js
{ _id, carName, carType, imageUrl, dailyRentPrice, seatCapacity, pickupLocation, description, availabilityStatus, ownerEmail, ownerName, ownerPhoto, bookingCount:0, createdAt }
```

**bookings**
```js
{ _id, carId, carName, carImage, carType, dailyRentPrice, pickupLocation, userEmail, userName, driverNeeded, specialNote, startDate, endDate, totalPrice, paymentStatus, paymentMethod, transactionId, bookingDate }
```

**reviews**
```js
{ _id, carId, carName, rating 1-5, comment, userEmail, userName, userPhoto, createdAt }
```

---

## 🛡️ Security

| Concern | Mitigation |
|---------|------------|
| XSS | HTTPOnly cookie |
| CSRF | SameSite=None; Secure |
| Overlap double-book | `findOne({carId, startDate:{$lte:newEnd}, endDate:{$gte:newStart}})` → 409 |
| Owner spoof | `ownerEmail = req.user.email` |
| ID crash | `isValidObjectId` |
| Regex inject | `escapeRegex` |
| CORS | allow-list `[localhost:5173,5174, vercel]` + `credentials:true` + `optionsSuccessStatus` |
| Rate | 200/15m |

---

## ☁️ Deploy (Vercel)

```json
// vercel.json
{ "version":2, "builds":[{"src":"index.js","use":"@vercel/node"}], "routes":[{"src":"/(.*)","dest":"index.js"}] }
```

1. Push to GitHub
2. Import Vercel → add env vars → Deploy
3. Production checklist: `JWT_SECRET` random, Atlas `0.0.0.0/0`, CORS, cookies `Secure`

---

## 📜 Scripts

| `npm start` | node |
| `npm run dev` | nodemon |
| `npm test` | jest (sample `tests/api.test.js`) |

---

## 🤝 Contributing & License

PR welcome. **MIT** — by [Fahim Rana](https://github.com/fahim3101)

📧 fahimrana3101@gmail.com | 📱 +8801818858015 | [LinkedIn](https://www.linkedin.com/in/fahim-rana/)
