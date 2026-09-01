// DriveFleet Server v5 - Secured & Production Ready
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
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
let reviewsCollection;

async function connectDB() {
  try {
    if (!carsCollection) {
      await client.connect();
      const db = client.db('drivefleet');
      carsCollection = db.collection('cars');
      bookingsCollection = db.collection('bookings');
      reviewsCollection = db.collection('reviews');
      // Create indexes for performance
      try {
        await carsCollection.createIndex({ carName: 'text' });
        await carsCollection.createIndex({ carType: 1 });
        await carsCollection.createIndex({ ownerEmail: 1 });
        await bookingsCollection.createIndex({ userEmail: 1 });
        await bookingsCollection.createIndex({ carId: 1 });
        await bookingsCollection.createIndex({ startDate: 1, endDate: 1 });
        await reviewsCollection.createIndex({ carId: 1 });
        await reviewsCollection.createIndex({ userEmail: 1 });
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

const verifyAdmin = (req, res, next) => {
  const adminEmailEnv = process.env.ADMIN_EMAIL;
  if (!adminEmailEnv) return res.status(500).send({ message: 'ADMIN_EMAIL not configured on server' });
  const allowedEmails = adminEmailEnv.split(',').map((e) => e.trim().toLowerCase());
  if (!allowedEmails.includes(req.user.email.toLowerCase())) return res.status(403).send({ message: 'Forbidden: Admin email required' });
  const adminToken = req.cookies?.adminToken;
  if (!adminToken) return res.status(403).send({ message: 'Admin password required. Please login at /admin/login' });
  jwt.verify(adminToken, process.env.JWT_SECRET, (err, decoded) => {
    if (err || decoded.role !== 'admin') return res.status(403).send({ message: 'Invalid admin session. Please re-login.' });
    req.admin = decoded;
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

// ── Email Service (Nodemailer) ────────────────────────────
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  transporter.verify((err) => {
    if (err) console.error('📧 SMTP verify failed:', err.message);
    else console.log('📧 SMTP ready');
  });
} else {
  console.log('📧 SMTP not configured - booking emails will be logged to console (mock mode)');
}

const sendBookingEmail = async ({ to, carName, totalPrice, startDate, endDate, driverNeeded }) => {
  const subject = `✅ DriveFleet - Booking Confirmed: ${carName}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f1a;color:#fff;padding:24px;border-radius:12px">
      <h2 style="color:#E63946">🎉 Booking Confirmed!</h2>
      <p>Hi there,</p>
      <p>Your booking for <strong>${carName}</strong> has been confirmed.</p>
      <table style="width:100%;background:#16213E;border-radius:8px;padding:12px;margin:16px 0">
        <tr><td style="color:#999">Car</td><td><strong>${carName}</strong></td></tr>
        <tr><td style="color:#999">Total</td><td style="color:#E63946;font-weight:bold">$${totalPrice}</td></tr>
        ${startDate ? `<tr><td style="color:#999">Dates</td><td>${new Date(startDate).toLocaleDateString()} → ${endDate ? new Date(endDate).toLocaleDateString() : 'N/A'}</td></tr>` : ''}
        <tr><td style="color:#999">Driver</td><td>${driverNeeded}</td></tr>
      </table>
      <p>We’ll contact you shortly with pickup details. Thank you for choosing <strong>DriveFleet</strong>!</p>
      <p style="color:#666;font-size:12px;margin-top:24px">This is an automated email, please do not reply.</p>
    </div>
  `;
  const text = `Booking Confirmed: ${carName} | Total: $${totalPrice} | Dates: ${startDate || 'N/A'} -> ${endDate || 'N/A'} | Driver: ${driverNeeded}`;

  if (!transporter) {
    console.log(`📧 [MOCK EMAIL] To: ${to} | Subject: ${subject} | ${text}`);
    return { mocked: true };
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    console.log(`📧 Email sent to ${to} for ${carName}`);
    return { sent: true };
  } catch (err) {
    console.error('📧 Email send failed:', err.message);
    return { error: err.message };
  }
};

const sendCancellationEmail = async ({ to, carName }) => {
  const subject = `❌ DriveFleet - Booking Cancelled: ${carName}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0f1a;color:#fff;padding:24px;border-radius:12px"><h2 style="color:#E63946">Booking Cancelled</h2><p>Your booking for <strong>${carName}</strong> has been cancelled.</p><p>If this was a mistake, please book again on DriveFleet.</p><p style="color:#666;font-size:12px;margin-top:24px">This is an automated email.</p></div>`;
  const text = `Booking Cancelled: ${carName}`;
  if (!transporter) {
    console.log(`📧 [MOCK CANCEL EMAIL] To: ${to} | ${text}`);
    return { mocked: true };
  }
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
    console.log(`📧 Cancellation email sent to ${to}`);
    return { sent: true };
  } catch (err) {
    console.error('📧 Cancel email failed:', err.message);
    return { error: err.message };
  }
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

// ── Admin Auth ───────────────────────────────────────────
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASS;
  if (!adminPass) return res.status(500).send({ message: 'ADMIN_PASS not configured' });
  if (!password) return res.status(400).send({ message: 'Password required' });
  if (password !== adminPass) return res.status(401).send({ message: 'Invalid admin password' });
  // Also set a short-lived admin cookie for extra verification (optional)
  const adminToken = jwt.sign({ role: 'admin', email: process.env.ADMIN_EMAIL }, process.env.JWT_SECRET, { expiresIn: '2h' });
  res
    .cookie('adminToken', adminToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 2 * 60 * 60 * 1000,
    })
    .send({ success: true, message: 'Admin authenticated' });
});

app.post('/admin/logout', (req, res) => {
  res.clearCookie('adminToken', { httpOnly: true, secure: true, sameSite: 'none' }).send({ success: true });
});

app.get('/admin/check', verifyToken, (req, res) => {
  const isAdmin = req.user.email === process.env.ADMIN_EMAIL;
  const hasAdminPass = !!req.cookies?.adminToken;
  // For MVP, email whitelist is primary; adminToken is optional extra
  res.send({ isAdmin, hasAdminPass, adminEmail: process.env.ADMIN_EMAIL });
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

    // ── Booking conflict check: prevent overlapping dates for same car
    if (startDate && endDate) {
      const newStart = new Date(startDate);
      const newEnd = new Date(endDate);
      const conflict = await bookingsCollection.findOne({
        carId,
        startDate: { $lte: newEnd },
        endDate: { $gte: newStart },
      });
      if (conflict) {
        return res.status(409).send({
          message: `Car already booked from ${new Date(conflict.startDate).toLocaleDateString()} to ${new Date(conflict.endDate).toLocaleDateString()}. Please choose different dates.`,
        });
      }
    }

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
      paymentStatus: req.body.paymentStatus || 'paid',
      paymentMethod: req.body.paymentMethod || 'mock',
      transactionId: req.body.transactionId || `txn_${Date.now()}`,
      bookingDate: new Date(),
    };

    const result = await bookingsCollection.insertOne(booking);
    await carsCollection.updateOne({ _id: new ObjectId(carId) }, { $inc: { bookingCount: 1 } });

    // Send confirmation email (non-blocking but await for logging)
    try {
      await sendBookingEmail({
        to: booking.userEmail,
        carName: booking.carName,
        totalPrice: booking.totalPrice || booking.dailyRentPrice,
        startDate: booking.startDate,
        endDate: booking.endDate,
        driverNeeded: booking.driverNeeded,
      });
    } catch (e) {
      console.error('Email error:', e.message);
    }

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
    try {
      await sendCancellationEmail({ to: booking.userEmail, carName: booking.carName });
    } catch (e) {
      console.error('Cancel email error:', e.message);
    }
    res.send(result);
  } catch (err) {
    next(err);
  }
});

// ── Reviews Routes ───────────────────────────────────────
app.post('/reviews', verifyToken, async (req, res, next) => {
  try {
    const { carId, rating, comment } = req.body;
    if (!carId || !isValidObjectId(carId)) return res.status(400).send({ message: 'Valid carId required' });
    if (!rating || isNaN(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) return res.status(400).send({ message: 'Rating must be 1-5' });
    const car = await carsCollection.findOne({ _id: new ObjectId(carId) });
    if (!car) return res.status(404).send({ message: 'Car not found' });

    // Optional: check user has booked this car
    // const hasBooked = await bookingsCollection.findOne({ carId, userEmail: req.user.email });
    // if (!hasBooked) return res.status(403).send({ message: 'You must book this car to review' });

    const review = {
      carId,
      carName: car.carName,
      rating: Number(rating),
      comment: (comment || '').trim().slice(0, 500),
      userEmail: req.user.email,
      userName: req.body.userName || req.user.email,
      userPhoto: req.body.userPhoto || '',
      createdAt: new Date(),
    };
    const result = await reviewsCollection.insertOne(review);
    res.status(201).send(result);
  } catch (err) {
    next(err);
  }
});

app.get('/reviews/:carId', async (req, res, next) => {
  try {
    const { carId } = req.params;
    if (!isValidObjectId(carId)) return res.status(400).send({ message: 'Invalid carId' });
    const reviews = await reviewsCollection.find({ carId }).sort({ createdAt: -1 }).toArray();
    const avg = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;
    res.send({ reviews, avg, count: reviews.length });
  } catch (err) {
    next(err);
  }
});

app.delete('/reviews/:id', verifyToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).send({ message: 'Invalid review ID' });
    const review = await reviewsCollection.findOne({ _id: new ObjectId(id) });
    if (!review) return res.status(404).send({ message: 'Review not found' });
    if (review.userEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden: Not your review' });
    const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    next(err);
  }
});

// ── Admin Routes ─────────────────────────────────────────
app.get('/admin/stats', verifyToken, verifyAdmin, async (req, res, next) => {
  try {
    const totalCars = await carsCollection.countDocuments();
    const totalBookings = await bookingsCollection.countDocuments();
    const availableCars = await carsCollection.countDocuments({ availabilityStatus: 'Available' });
    const unavailableCars = totalCars - availableCars;
    const recentCars = await carsCollection.find().sort({ _id: -1 }).limit(5).toArray();
    const recentBookings = await bookingsCollection.find().sort({ bookingDate: -1 }).limit(5).toArray();
    const carsByType = await carsCollection.aggregate([{ $group: { _id: '$carType', count: { $sum: 1 } } }]).toArray();
    const revenueAgg = await bookingsCollection.aggregate([{ $group: { _id: null, total: { $sum: '$totalPrice' } } }]).toArray();
    const totalRevenue = revenueAgg[0]?.total || 0;
    // Monthly bookings last 6 months
    const monthlyBookings = await bookingsCollection
      .aggregate([
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$bookingDate' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 6 },
      ])
      .toArray();
    res.send({ totalCars, totalBookings, availableCars, unavailableCars, recentCars, recentBookings, carsByType, totalRevenue, monthlyBookings });
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
