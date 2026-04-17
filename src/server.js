require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { PrismaClient } = require('@prisma/client');

const authRoutes      = require('./routes/auth');
const productRoutes   = require('./routes/products');
const categoryRoutes  = require('./routes/categories');
const supplierRoutes  = require('./routes/suppliers');
const saleRoutes      = require('./routes/sales');
const quoteRoutes     = require('./routes/quotes');
const invoiceRoutes   = require('./routes/invoices');
const reportRoutes    = require('./routes/reports');
const stockRoutes     = require('./routes/stock');

const { errorHandler } = require('./middleware/errorHandler');
const { authenticate } = require('./middleware/auth');
const logger = require('./utils/logger');

const app = express();
const prisma = new PrismaClient();

// ─── MIDDLEWARE GLOBAL ──────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'https://ferreteria-pos-frontend-gamma.vercel.app'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const isAllowed = allowedOrigins.some(o => origin.startsWith(o));

    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('❌ CORS bloqueado:', origin);
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
}));

app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// ─── RUTAS PÚBLICAS ─────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ─── RUTAS PROTEGIDAS ───────────────────────────────────────────────────────
app.use('/api/products',   authenticate, productRoutes);
app.use('/api/categories', authenticate, categoryRoutes);
app.use('/api/suppliers',  authenticate, supplierRoutes);
app.use('/api/sales',      authenticate, saleRoutes);
app.use('/api/quotes',     authenticate, quoteRoutes);
app.use('/api/invoices',   authenticate, invoiceRoutes);
app.use('/api/reports',    authenticate, reportRoutes);
app.use('/api/stock',      authenticate, stockRoutes);

// ─── HEALTH CHECK ───────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', ts: new Date() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ─── ERROR HANDLER ──────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── INICIO ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info(`🔧 Ferretería POS API corriendo en http://localhost:${PORT}`);
});

// Cierre limpio
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  logger.info('DB desconectada. Servidor detenido.');
  process.exit(0);
});

module.exports = app;
