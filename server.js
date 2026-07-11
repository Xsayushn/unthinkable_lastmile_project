/**
 * server.js — Last-Mile Delivery Tracker (Pune Edition)
 * Main application entry point. Configures middleware and mounts routes.
 */

const fs   = require('fs');
const path = require('path');

// ── Inline .env loader (no dotenv dependency) ─────────────────────────────────
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8')
      .split(/\r?\n/)
      .forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...values] = trimmed.split('=');
          const val = values.join('=').trim().replace(/^["']|["']$/g, '');
          process.env[key.trim()] = val;
        }
      });
  }
} catch (e) {
  console.warn('Could not load .env file:', e.message);
}

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');

const { seedDatabase } = require('./db-helper');
const { apiLimiter }   = require('./middleware/rateLimiter');

// Route modules
const authRoutes          = require('./routes/auth');
const orderRoutes         = require('./routes/orders');
const zoneRoutes          = require('./routes/zones');
const rateRoutes          = require('./routes/rates');
const agentRoutes         = require('./routes/agents');
const customerRoutes      = require('./routes/customers');
const notificationRoutes  = require('./routes/notifications');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security Headers (Helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "unpkg.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "unpkg.com"],
      fontSrc:    ["'self'", "fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "*.cartocdn.com", "raw.githubusercontent.com",
                   "cdnjs.cloudflare.com", "*.basemaps.cartocdn.com"],
      connectSrc: ["'self'"],
      frameSrc:   ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false // Leaflet tiles require cross-origin
}));

// ── CORS — restrict to known origins ─────────────────────────────────────────
const allowedOrigins = [
  `http://localhost:${PORT}`,
  'http://127.0.0.1:' + PORT
];
if (process.env.RENDER_EXTERNAL_URL) {
  allowedOrigins.push(process.env.RENDER_EXTERNAL_URL);
}

const corsOptionsDelegate = (req, callback) => {
  const origin = req.header('Origin');
  let isAllowed = false;
  
  if (!origin) {
    isAllowed = true;
  } else {
    // Check whitelisted origins
    if (allowedOrigins.includes(origin) || allowedOrigins.includes(origin + '/')) {
      isAllowed = true;
    } else {
      // Dynamically check if same-origin (host header matches origin)
      try {
        const originUrl = new URL(origin);
        if (originUrl.host === req.headers.host) {
          isAllowed = true;
        }
      } catch (e) {}
    }
  }

  callback(null, { origin: isAllowed, credentials: true });
};
app.use(cors(corsOptionsDelegate));

// ── Body Parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// ── Global API rate limiter ───────────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ── Static File Serving ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: true
}));

// ── Database Seed on Startup (skip in test env) ───────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  seedDatabase().catch(console.error);
}

// ── API Route Mounting ────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/orders',        orderRoutes);
app.use('/api/zones',         zoneRoutes);
app.use('/api/rates',         rateRoutes);
app.use('/api/agents',        agentRoutes);
app.use('/api/customers',     customerRoutes);
app.use('/api/notifications', notificationRoutes);

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Resource not found.' });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error.' });
});

// ── Start Server (skip in test environment) ──────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log('==================================================');
    console.log(`Last-Mile Delivery Tracker running on port ${PORT}`);
    console.log(`Address: http://localhost:${PORT}`);
    console.log('==================================================');
  });
}

module.exports = app; // Export for testing with supertest
