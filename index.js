// DriveFleet Server v5 - Secured & Production Ready
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// ── Security Middlewares ─────────────────────────────────
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { message: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://drivefleet-client-nine.vercel.app',
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Health check
app.get('/', (req, res) => {
  res.send('DriveFleet Server is Running! v5');
});

// ── MongoDB ──────────────────────────────────────────────
const uri = process.env.MONGODB_URI;
if (!uri) console.error('❌ MONGODB_URI missing in .env');
const client = new MongoClient(uri);

let carsCollection;
let bookingsCollection;

async function connectDB() {
  try {
    if (!carsCollection) {
      await client.connect();
      const db = client.db('drivefleet');
      carsCollection = db.collection('cars');
      bookingsCollection = db.collection('bookings');
      // Create indexes for performance
      try {
        await carsCollection.createIndex({ carName: 'text' });
        await carsCollection.createIndex({ carType: 1 });
        await carsCollection.createIndex({ ownerEmail: 1 });
        await bookingsCollection.createIndex({ userEmail: 1 });
        await bookingsCollection.createIndex({ carId: 1 });
      } catch (e) {
        // Index creation may fail if already exists - ignore
      }
      console.log('✅ MongoDB connected!');
    }
  } catch (err) {
    console.error('❌ MongoDB error:', err.message);
  }
}

connectDB();

// Ensure DB connected for every request (vercel cold start)
app.use(async (req, res, next) => {
  if (!carsCollection) {
    await connectDB();
  }
  next();
});

// ── Helpers ──────────────────────────────────────────────
const isValidObjectId = (id) => ObjectId.isValid(id) && String(new ObjectId(id)) === id;

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).send({ message: 'Unauthorized: No token' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: 'Forbidden: Invalid or expired token' });
    req.user = decoded;
    next();
  });
};

// Validation helpers
const validateCarPayload = (body) => {
  const errors = [];
  if (!body.carName || typeof body.carName !== 'string' || body.carName.trim().length < 2)
    errors.push('carName is required (min 2 chars)');
  if (body.dailyRentPrice === undefined || isNaN(Number(body.dailyRentPrice)) || Number(body.dailyRentPrice) <= 0)
    errors.push('dailyRentPrice must be a positive number');
  if (!body.carType || typeof body.carType !== 'string') errors.push('carType is required');
  if (!body.imageUrl || typeof body.imageUrl !== 'string') errors.push('imageUrl is required');
  if (body.seatCapacity !== undefined && (isNaN(Number(body.seatCapacity)) || Number(body.seatCapacity) < 1 || Number(body.seatCapacity) > 50))
    errors.push('seatCapacity must be between 1 and 50');
  if (!body.pickupLocation || typeof body.pickupLocation !== 'string') errors.push('pickupLocation is required');
  return errors;
};

// ── Auth Routes ──────────────────────────────────────────
app.post('/jwt', (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).send({ message: 'Valid email is required' });
  }
  const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const isProduction = process.env.NODE_ENV === 'production';
  res
    .cookie('token', token, {
      httpOnly: true,
      secure: isProduction ? true : true, // Always true for SameSite None; Vercel requires Secure
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    .send({ success: true });
});

app.post('/logout', (req, res) => {
  res
    .clearCookie('token', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    })
    .send({ success: true });
});

// ── Cars Routes ──────────────────────────────────────────

// GET /cars with pagination, search, filter, sort
app.get('/cars', async (req, res, next) => {
  try {
    const { search, type, sort = 'newest', page = 1, limit = 12, minPrice, maxPrice, availability } = req.query;
    let query = {};

    if (search) {
      query.carName = { $regex: escapeRegex(search), $options: 'i' };
    }
    if (type && type !== 'all') {
      query.carType = type; // Fixed: was { $in: [type] } incorrectly when carType is string
    }
    if (availability && availability !== 'all') {
      query.availabilityStatus = availability;
    }
    if (minPrice || maxPrice) {
      query.dailyRentPrice = {};
      if (minPrice) query.dailyRentPrice.$gte = Number(minPrice);
      if (maxPrice) query.dailyRentPrice.$lte = Number(maxPrice);
      if (Object.keys(query.dailyRentPrice).length === 0) delete query.dailyRentPrice;
    }

    // Sorting
    let sortOption = { _id: -1 }; // newest
    if (sort === 'price_low') sortOption = { dailyRentPrice: 1 };
    else if (sort === 'price_high') sortOption = { dailyRentPrice: -1 };
    else if (sort === 'popular') sortOption = { bookingCount: -1 };
    else if (sort === 'oldest') sortOption = { _id: 1 };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 12));
    const skip = (pageNum - 1) * limitNum;

    const total = await carsCollection.countDocuments(query);
    const cars = await carsCollection.find(query).sort(sortOption).skip(skip).limit(limitNum).toArray();

    res.send({ cars, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) {
    next(err);
  }
});

// Keep backward compat: if client expects array, also handle? But new returns object.
// For old clients that expect array, they can use cars field. We keep array fallback for no pagination params.
// Actually to keep backward compat, if no page/limit query, return array directly? No, better return object and client updated.

app.get('/cars/latest', async (req, res, next) => {
  try {
    const cars = await carsCollection.find().sort({ _id: -1 }).limit(6).toArray();
    res.send(cars);
  } catch (err) {
    next(err);
  }
});

app.get('/cars/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).send({ message: 'Invalid car ID' });
    const car = await carsCollection.findOne({ _id: new ObjectId(id) });
    if (!car) return res.status(404).send({ message: 'Car not found' });
    res.send(car);
  } catch (err) {
    next(err);
  }
});

app.get('/my-cars', verifyToken, async (req, res, next) => {
  try {
    if (req.user.email !== req.query.email) return res.status(403).send({ message: 'Forbidden' });
    const cars = await carsCollection.find({ ownerEmail: req.query.email }).sort({ _id: -1 }).toArray();
    res.send(cars);
  } catch (err) {
    next(err);
  }
});

app.post('/cars', verifyToken, async (req, res, next) => {
  try {
    const errors = validateCarPayload(req.body);
    if (errors.length) return res.status(400).send({ message: errors.join(', ') });

    // Force owner from token, prevent spoofing
    const car = {
      carName: req.body.carName.trim(),
      carType: req.body.carType,
      imageUrl: req.body.imageUrl,
      dailyRentPrice: Number(req.body.dailyRentPrice),
      seatCapacity: Number(req.body.seatCapacity) || 4,
      pickupLocation: req.body.pickupLocation,
      description: req.body.description || '',
      availabilityStatus: req.body.availabilityStatus || 'Available',
      ownerEmail: req.user.email, // enforced
      ownerName: req.body.ownerName || req.user.email,
      ownerPhoto: req.body.ownerPhoto || '',
      bookingCount: 0,
      createdAt: new Date(),
    };

    const result = await carsCollection.insertOne(car);
    res.status(201).send(result);
  } catch (err) {
    next(err);
  }
});

app.put('/cars/:id', verifyToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).send({ message: 'Invalid car ID' });

    // Check ownership
    const existing = await carsCollection.findOne({ _id: new ObjectId(id) });
    if (!existing) return res.status(404).send({ message: 'Car not found' });
    if (existing.ownerEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden: Not your car' });

    const { _id, ownerEmail, bookingCount, createdAt, ...updateData } = req.body;

    // Whitelist allowed fields and sanitize
    const allowed = ['carName', 'carType', 'imageUrl', 'dailyRentPrice', 'seatCapacity', 'pickupLocation', 'description', 'availabilityStatus'];
    const sanitized = {};
    for (const key of allowed) {
      if (updateData[key] !== undefined) sanitized[key] = updateData[key];
    }
    if (sanitized.dailyRentPrice !== undefined) sanitized.dailyRentPrice = Number(sanitized.dailyRentPrice);
    if (sanitized.seatCapacity !== undefined) sanitized.seatCapacity = Number(sanitized.seatCapacity);
    if (sanitized.carName) sanitized.carName = sanitized.carName.trim();

    if (Object.keys(sanitized).length === 0) return res.status(400).send({ message: 'No valid fields to update' });

    const result = await carsCollection.updateOne({ _id: new ObjectId(id) }, { $set: sanitized });
    res.send(result);
  } catch (err) {
    next(err);
  }
});

app.delete('/cars/:id', verifyToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).send({ message: 'Invalid car ID' });

    const existing = await carsCollection.findOne({ _id: new ObjectId(id) });
    if (!existing) return res.status(404).send({ message: 'Car not found' });
    if (existing.ownerEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden: Not your car' });

    const result = await carsCollection.deleteOne({ _id: new ObjectId(id) });
    // Also delete related bookings? Optional - keep for history
    res.send(result);
  } catch (err) {
    next(err);
  }
});

// ── Booking Routes ───────────────────────────────────────

app.post('/bookings', verifyToken, async (req, res, next) => {
  try {
    const { carId, startDate, endDate } = req.body;
    if (!carId || !isValidObjectId(carId)) return res.status(400).send({ message: 'Valid carId is required' });
    if (!req.body.carName) return res.status(400).send({ message: 'carName required' });

    // Fetch car to validate
    const car = await carsCollection.findOne({ _id: new ObjectId(carId) });
    if (!car) return res.status(404).send({ message: 'Car not found' });
    if (car.availabilityStatus !== 'Available') return res.status(400).send({ message: 'Car is not available for booking' });
    if (car.ownerEmail === req.user.email) return res.status(400).send({ message: 'You cannot book your own car' });

    // Date validation if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return res.status(400).send({ message: 'Invalid dates' });
      if (end <= start) return res.status(400).send({ message: 'End date must be after start date' });
      if (start < new Date(new Date().setHours(0, 0, 0, 0))) return res.status(400).send({ message: 'Start date cannot be in the past' });
    }

    // Prevent duplicate booking by same user for same car with same dates? Simple check - same carId and userEmail and not cancelled
    // For now allow multiple but could check

    const booking = {
      carId,
      carName: req.body.carName,
      carImage: req.body.carImage || car.imageUrl,
      carType: req.body.carType || car.carType,
      dailyRentPrice: Number(req.body.dailyRentPrice) || car.dailyRentPrice,
      pickupLocation: req.body.pickupLocation || car.pickupLocation,
      userEmail: req.user.email, // enforced from token
      userName: req.body.userName || req.user.email,
      driverNeeded: req.body.driverNeeded || 'No',
      specialNote: req.body.specialNote || '',
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      totalPrice: req.body.totalPrice ? Number(req.body.totalPrice) : undefined,
      bookingDate: new Date(),
    };

    const result = await bookingsCollection.insertOne(booking);
    await carsCollection.updateOne({ _id: new ObjectId(carId) }, { $inc: { bookingCount: 1 } });
    res.status(201).send(result);
  } catch (err) {
    next(err);
  }
});

app.get('/bookings', verifyToken, async (req, res, next) => {
  try {
    if (req.user.email !== req.query.email) return res.status(403).send({ message: 'Forbidden' });
    const bookings = await bookingsCollection.find({ userEmail: req.query.email }).sort({ bookingDate: -1 }).toArray();
    res.send(bookings);
  } catch (err) {
    next(err);
  }
});

app.delete('/bookings/:id', verifyToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).send({ message: 'Invalid booking ID' });

    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) return res.status(404).send({ message: 'Booking not found' });
    if (booking.userEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden: Not your booking' });

    const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) });
    // Decrement bookingCount
    if (booking.carId && isValidObjectId(booking.carId)) {
      await carsCollection.updateOne({ _id: new ObjectId(booking.carId) }, { $inc: { bookingCount: -1 } });
    }
    res.send(result);
  } catch (err) {
    next(err);
  }
});

// ── Global Error Handler ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error('🔥 Error:', err.message);
  res.status(err.status || 500).send({ message: err.message || 'Internal Server Error' });
});

// ── Start Server (Vercel compatibility) ──────────────────
if (require.main === module) {
  app.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
  });
}

module.exports = app;
