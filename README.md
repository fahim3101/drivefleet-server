# DriveFleet Server

Backend API for the DriveFleet Car Rental Platform.

## Setup

1. Clone this repository
2. Run `npm install`
3. Copy `.env.example` to `.env` and fill in your values
4. Run `npm run dev` to start the development server

## Environment Variables

```
PORT=5000
MONGODB_URI=your_mongodb_atlas_uri
JWT_SECRET=your_secret_key
NODE_ENV=production
```

## API Endpoints

- `POST /jwt` — Generate JWT token
- `POST /logout` — Clear JWT cookie
- `GET /cars` — Get all cars (search & filter)
- `GET /cars/latest` — Get 6 latest cars
- `GET /cars/:id` — Get single car
- `GET /my-cars` — Get owner's cars (protected)
- `POST /cars` — Add new car (protected)
- `PUT /cars/:id` — Update car (protected)
- `DELETE /cars/:id` — Delete car (protected)
- `GET /bookings` — Get user bookings (protected)
- `POST /bookings` — Create booking (protected)
- `DELETE /bookings/:id` — Cancel booking (protected)
