require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://drivefleet-client.vercel.app'
  ],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// ✅ Root route OUTSIDE run()
app.get('/', (req, res) => {
  res.send('DriveFleet Server is Running!');
});

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  ssl: true,
  tls: true,
});

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).send({ message: 'Unauthorized' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: 'Forbidden' });
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    await client.connect();
    const db = client.db('drivefleet');
    const carsCollection = db.collection('cars');
    const bookingsCollection = db.collection('bookings');

    app.post('/jwt', (req, res) => {
      const token = jwt.sign(req.body, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
      }).send({ success: true });
    });

    app.post('/logout', (req, res) => {
      res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
      }).send({ success: true });
    });

    app.get('/cars', async (req, res) => {
      try {
        const { search, type } = req.query;
        let query = {};
        if (search) query.carName = { $regex: search, $options: 'i' };
        if (type && type !== 'all') query.carType = { $in: [type] };
        const cars = await carsCollection.find(query).sort({ _id: -1 }).toArray();
        res.send(cars);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    app.get('/cars/latest', async (req, res) => {
      try {
        const cars = await carsCollection.find().sort({ _id: -1 }).limit(6).toArray();
        res.send(cars);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    app.get('/cars/:id', async (req, res) => {
      try {
        const car = await carsCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!car) return res.status(404).send({ message: 'Car not found' });
        res.send(car);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    app.get('/my-cars', verifyToken, async (req, res) => {
      try {
        if (req.user.email !== req.query.email) return res.status(403).send({ message: 'Forbidden' });
        const cars = await carsCollection.find({ ownerEmail: req.query.email }).sort({ _id: -1 }).toArray();
        res.send(cars);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    app.post('/cars', verifyToken, async (req, res) => {
      try {
        const car = { ...req.body, bookingCount: 0, createdAt: new Date() };
        const result = await carsCollection.insertOne(car);
        res.send(result);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    app.put('/cars/:id', verifyToken, async (req, res) => {
      try {
        const { _id, ...updateData } = req.body;
        const result = await carsCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: updateData });
        res.send(result);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    app.delete('/cars/:id', verifyToken, async (req, res) => {
      try {
        const result = await carsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    app.post('/bookings', verifyToken, async (req, res) => {
      try {
        const booking = { ...req.body, bookingDate: new Date() };
        const result = await bookingsCollection.insertOne(booking);
        await carsCollection.updateOne({ _id: new ObjectId(req.body.carId) }, { $inc: { bookingCount: 1 } });
        res.send(result);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    app.get('/bookings', verifyToken, async (req, res) => {
      try {
        if (req.user.email !== req.query.email) return res.status(403).send({ message: 'Forbidden' });
        const bookings = await bookingsCollection.find({ userEmail: req.query.email }).sort({ bookingDate: -1 }).toArray();
        res.send(bookings);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    app.delete('/bookings/:id', verifyToken, async (req, res) => {
      try {
        const result = await bookingsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
      } catch (err) { res.status(500).send({ message: err.message }); }
    });

    console.log('Successfully connected to MongoDB!');
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
}

run();

app.listen(port, () => {
  console.log(`DriveFleet server running on port ${port}`);
});