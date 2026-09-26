/**
 * ─── Catalog Maker: Express Server Entry Point ───
 * 
 * Initializes the Express server, connects to the database,
 * seeds categories, mounts API routes, and serves the static client.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
const { initializeDatabase, closeDb } = require('./server/db/database');
const { seedDatabase } = require('./server/db/seed');
const { responseTime, adminCacheInvalidation } = require('./server/middleware/cache');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════
// MIDDLEWARE — Performance Layer
// ═══════════════════════════════════════════════

// Response compression (gzip/brotli for JSON payloads)
app.use(compression({
  threshold: 512,  // Only compress responses > 512 bytes
  filter: (req, res) => {
    // Compress JSON and text responses
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// Response time tracking (X-Response-Time header)
app.use(responseTime);

// CORS
app.use(cors());

// JSON body parser
app.use(express.json({ limit: '1mb' }));

// Request logging (compact in production)
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// ═══════════════════════════════════════════════
// STATIC FILE SERVING — with cache headers
// ═══════════════════════════════════════════════
app.use(express.static(path.join(__dirname, 'client'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
  lastModified: true,
}));

// ═══════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════
const catalogRoutes = require('./server/routes/catalog');
const adminRoutes = require('./server/routes/admin');

// Public catalog API (read-only, cached)
app.use('/api/catalog', catalogRoutes);

// Admin API (write-capable, with cache invalidation)
app.use('/api/admin', adminCacheInvalidation, adminRoutes);

// ═══════════════════════════════════════════════
// HEALTH CHECK — with performance metrics
// ═══════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss_mb: Math.round(memUsage.rss / 1024 / 1024),
      heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
    },
    node_version: process.version,
  });
});

// ═══════════════════════════════════════════════
// ADMIN PORTAL & SPA FALLBACK
// ═══════════════════════════════════════════════
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'admin.html'));
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// ═══════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack || err.message);
  res.status(err.status || 500).json({
    error: {
      message: process.env.NODE_ENV === 'production'
        ? 'An internal server error occurred.'
        : err.message,
    },
  });
});

// ═══════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════
async function startServer() {
  try {
    // 1. Initialize database schema
    console.log('\n═══ CATALOG MAKER — KICKS VAULT ═══\n');
    initializeDatabase();

    // 2. Seed with demo data if empty
    seedDatabase();

    // 3. Start Express
    app.listen(PORT, () => {
      console.log(`\n[SERVER] 🚀 Catalog Maker running at http://localhost:${PORT}`);
      console.log(`[SERVER]    API:   http://localhost:${PORT}/api/catalog/products`);
      console.log(`[SERVER]    Admin: http://localhost:${PORT}/api/admin/settings`);
      console.log(`[SERVER]    Health: http://localhost:${PORT}/api/health`);
      console.log(`[SERVER]    Compression: ON | ETags: ON | Response-Time: ON\n`);
    });
  } catch (error) {
    console.error('[FATAL] Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[SERVER] Shutting down gracefully...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});

startServer();
