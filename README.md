# 🚗 DriveFleet — Premium Car Rental Platform (Server)

A production-grade **REST API** that powers the DriveFleet car rental marketplace. Built with **Node.js**, **Express**, and **MongoDB Atlas**, it handles authentication, car listings, search, filtering, and booking workflows behind JWT-secured endpoints.

> **Frontend Repo:** [github.com/fahim3101/drivefleet-client](https://github.com/fahim3101/drivefleet-client)
> **Live API:** [https://drivefleet-server-orpin.vercel.app](https://drivefleet-server-orpin.vercel.app/)
> **Live Site:** [https://drivefleet-client-nine.vercel.app](https://drivefleet-client-nine.vercel.app/)

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Available Scripts](#-available-scripts)
- [API Reference](#-api-reference)
  - [Auth](#-authentication)
  - [Cars](#-cars)
  - [Bookings](#-bookings)
- [Data Models](#-data-models)
- [Security](#-security)
- [Deployment](#-deployment)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🧭 Overview

DriveFleet Server is a stateless JSON API that follows RESTful conventions. It uses **MongoDB native driver** (no Mongoose) for maximum control and minimal overhead, and issues **JWTs** stored in **HTTPOnly cookies** so the frontend never has to handle tokens in JavaScript.

```
┌──────────────────┐    HTTPS + HTTPOnly Cookie    ┌──────────────────┐
│  drivefleet-     │ ────────────────────────────▶ │  drivefleet-     │
│  client (React)  │ ◀──────────────────────────── │  server (Node)   │
└──────────────────┘      JSON response             └──────────────────┘
                                                              │
                                                              ▼
                                                    ┌──────────────────┐
                                                    │  MongoDB Atlas   │
                                                    │  (cars, bookings)│
                                                    └──────────────────┘
```

---

## 🌟 Features

- 🔐 **JWT Authentication** — signed tokens, 7-day expiry, stored in HTTPOnly cookies
- 🚗 **Car CRUD** — list, create, update, delete with owner-scope authorization
- 🔎 **Search & Filter** — case-insensitive regex search on car name + `$in` filter by car type
- 📋 **Booking Workflow** — atomic `bookingCount` increment via `$inc`
- 👤 **Owner-Scoped Routes** — users can only mutate their own cars & view their own bookings
- 🛡️ **CORS Hardening** — explicit origin allow-list, `credentials: true`
- ⚡ **Connection Caching** — single MongoClient instance, lazy-initialized
- 🧩 **Stateless** — horizontally scalable; no in-memory session

---

## 🛠️ Tech Stack

| Layer            | Technology                       |
| ---------------- | -------------------------------- |
| **Runtime**      | Node.js ≥ 18                     |
| **Framework**    | Express 4                        |
| **Database**     | MongoDB Atlas (native driver v4) |
| **Auth**         | `jsonwebtoken` (HS256)           |
| **Cookies**      | `cookie-parser`                  |
| **CORS**         | `cors` (with allow-list)         |
| **Config**       | `dotenv`                         |
| **Dev Tooling**  | `nodemon`                        |
| **Deployment**   | Vercel (Serverless)              |

---

## 📁 Project Structure

```
drivefleet-server/
├── index.js                # Express app, routes, middleware
├── vercel.json             # Vercel routing config
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

> The entire API is a **single `index.js` file** for simplicity. For a larger project, split into `routes/`, `controllers/`, `middlewares/`, `db/`.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- A **MongoDB Atlas** cluster (free M0 tier works) — or a local MongoDB instance
- A long random string for `JWT_SECRET`

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/fahim3101/drivefleet-server.git
cd drivefleet-server

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# then fill in the values (see below)

# 4. Start the dev server (auto-reload via nodemon)
npm run dev

# 5. Or run in production mode
npm start
```

The API will start on **http://localhost:5000** by default.

Visit `http://localhost:5000/` — you should see `DriveFleet Server is Running!`.

---

## 🔑 Environment Variables

Create a `.env` file in the project root (never commit this file):

```env
# Server port
PORT=5000

# MongoDB connection string (from Atlas → Connect → Drivers)
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority

# JWT signing secret — use a long random string (e.g. `openssl rand -base64 32`)
JWT_SECRET=replace-me-with-a-long-random-secret

# Environment
NODE_ENV=development
```

> 🔒 **Never** commit `.env` to version control. Rotate `JWT_SECRET` periodically and after any suspected leak.

---

## 📜 Available Scripts

| Command         | Description                                       |
| --------------- | ------------------------------------------------- |
| `npm start`     | Run the server with `node`                        |
| `npm run dev`   | Run the server with `nodemon` (auto-reload)       |

---

## 📡 API Reference

Base URL: `http://localhost:5000` (dev) or your deployed URL.

All protected routes require a valid `token` HTTPOnly cookie issued by `POST /jwt`.

---

### 🔐 Authentication

#### `POST /jwt` — Issue JWT cookie
**Access:** Public
**Body:** `{ email: string }`
**Response:** `{ success: true }` + sets `token` cookie

```bash
curl -X POST http://localhost:5000/jwt \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}' \
  -c cookies.txt
```

#### `POST /logout` — Clear JWT cookie
**Access:** Public
**Response:** `{ success: true }` + clears `token` cookie

```bash
curl -X POST http://localhost:5000/logout -b cookies.txt -c cookies.txt
```

---

### 🚗 Cars

#### `GET /cars` — List all cars
**Access:** Public
**Query params:**
- `search` *(optional)* — case-insensitive substring match on `carName`
- `type` *(optional)* — filter by `carType` (use `all` to skip filter)

**Response:** `Car[]` (sorted newest first)

```bash
curl "http://localhost:5000/cars?search=tesla&type=Electric"
```

#### `GET /cars/latest` — 6 newest cars
**Access:** Public
**Response:** `Car[]` (max 6)

```bash
curl http://localhost:5000/cars/latest
```

#### `GET /cars/:id` — Single car
**Access:** Public
**Response:** `Car`

```bash
curl http://localhost:5000/cars/68a1b2c3d4e5f6a7b8c9d0e1
```

#### `GET /my-cars` — Owner's listings
**Access:** 🔒 Protected
**Query params:** `email` *(required — must match JWT)*

```bash
curl http://localhost:5000/my-cars?email=user@example.com \
  -b cookies.txt
```

#### `POST /cars` — Add a car
**Access:** 🔒 Protected
**Body:** `Omit<Car, "_id" | "bookingCount" | "createdAt">`

```bash
curl -X POST http://localhost:5000/cars \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "carName": "Tesla Model 3",
    "carType": "Electric",
    "image": "https://...",
    "price": 120,
    "location": "Dhaka",
    "description": "...",
    "ownerName": "Fahim",
    "ownerEmail": "user@example.com"
  }'
```

#### `PUT /cars/:id` — Update a car
**Access:** 🔒 Protected
**Body:** Partial `Car` (the `_id` is stripped automatically)

```bash
curl -X PUT http://localhost:5000/cars/68a1b2c3d4e5f6a7b8c9d0e1 \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"price": 130}'
```

#### `DELETE /cars/:id` — Delete a car
**Access:** 🔒 Protected

```bash
curl -X DELETE http://localhost:5000/cars/68a1b2c3d4e5f6a7b8c9d0e1 \
  -b cookies.txt
```

---

### 📋 Bookings

#### `POST /bookings` — Create a booking
**Access:** 🔒 Protected
**Side effect:** atomically increments `bookingCount` on the corresponding car

```bash
curl -X POST http://localhost:5000/bookings \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "carId": "68a1b2c3d4e5f6a7b8c9d0e1",
    "userName": "Fahim",
    "userEmail": "user@example.com",
    "startDate": "2026-08-01",
    "endDate": "2026-08-05",
    "needsDriver": true,
    "notes": "Airport pickup"
  }'
```

#### `GET /bookings` — User's bookings
**Access:** 🔒 Protected
**Query params:** `email` *(required — must match JWT)*
**Response:** `Booking[]` (sorted newest first)

```bash
curl "http://localhost:5000/bookings?email=user@example.com" -b cookies.txt
```

#### `DELETE /bookings/:id` — Cancel a booking
**Access:** 🔒 Protected

```bash
curl -X DELETE http://localhost:5000/bookings/68a1b2c3d4e5f6a7b8c9d0e2 \
  -b cookies.txt
```

---

## 🗄️ Data Models

### `cars` collection

```js
{
  _id: ObjectId,
  carName: String,         // e.g. "Tesla Model 3"
  carType: String,         // e.g. "Electric" | "SUV" | "Sedan" | ...
  image: String,           // image URL
  price: Number,           // per day
  location: String,
  description: String,
  ownerName: String,
  ownerEmail: String,      // used for owner-scope checks
  bookingCount: Number,    // default 0
  createdAt: Date
}
```

### `bookings` collection

```js
{
  _id: ObjectId,
  carId: String,           // references cars._id as string
  userName: String,
  userEmail: String,       // used for owner-scope checks
  startDate: String,       // ISO date
  endDate: String,         // ISO date
  needsDriver: Boolean,
  notes: String,
  bookingDate: Date
}
```

---

## 🛡️ Security

| Concern                | Mitigation                                                           |
| ---------------------- | -------------------------------------------------------------------- |
| XSS / token theft      | JWT stored in **HTTPOnly** cookie — JavaScript cannot read it        |
| CSRF                   | `SameSite=None; Secure` — required for cross-site cookie on Vercel   |
| Man-in-the-middle      | HTTPS only in production; `secure: true` flag on the cookie          |
| Unauthorized mutation | `verifyToken` middleware on every protected route                    |
| Cross-tenant access   | Email-match check: `req.user.email === req.query.email`              |
| Open CORS              | Hard-coded `corsOptions.origin` allow-list                           |
| Secret exposure       | Secrets in `.env`, file is `.gitignore`d                            |

### Adding a new protected route

```js
app.post('/example', verifyToken, async (req, res) => {
  // req.user is set by verifyToken
  // ...your logic
});
```

---

## ☁️ Deployment

This server is **Vercel-ready** (see `vercel.json`).

### Deploy to Vercel

1. Push the repo to GitHub.
2. Import into [Vercel](https://vercel.com/new).
3. Add every env var from `.env` in **Settings → Environment Variables**.
4. Deploy 🚀

### `vercel.json`

```json
{
  "version": 2,
  "builds": [{ "src": "index.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "index.js" }]
}
```

### Production checklist

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` is a long random value
- [ ] MongoDB Atlas IP allow-list includes `0.0.0.0/0` *(or Vercel's NAT range)*
- [ ] CORS origin list includes your production frontend URL
- [ ] HTTPS-only cookies verified in DevTools → Application → Cookies

---

## 🗺️ Roadmap

- [ ] Pagination for `/cars`
- [ ] Index on `cars.carName` for faster regex search
- [ ] Rate limiting (`express-rate-limit`)
- [ ] Request validation with `zod` or `joi`
- [ ] Soft-delete for cars & bookings
- [ ] Refresh-token rotation
- [ ] File upload (multer + S3) for car images
- [ ] Email notifications (SendGrid / Resend)
- [ ] Docker support

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/awesome`
3. Commit: `git commit -m "feat: add awesome feature"`
4. Push: `git push origin feature/awesome`
5. Open a PR

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

**Made with ❤️ by [Fahim](https://github.com/fahim3101)**
