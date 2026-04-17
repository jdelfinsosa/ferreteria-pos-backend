const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const quotePdf = require('../services/quotePdf');
const mailer = require('../services/mailer');

const prisma = new PrismaClient();

async function nextFolio() {
  const last = await prisma.quote.findFirst({ orderBy: { id: 'desc' }, select: { folio: true } });
  const n = last ? parseInt(last.folio.split('-')[1]) + 1 : 1;
  return `C-${String(n).padStart(4, '0')}`;
}

// GET /api/quotes
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const where = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { clientName: { contains: search, mode: 'insensitive' } },
          { folio: { contains: search } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        include: { items: { include: { product: { select: { name: true, sku: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.quote.count({ where }),
    ]);

    res.json({ items, total });
  } catch (err) { next(err); }
});

// GET /api/quotes/:id
router.get('/:id', async (req, res, next) => {
  try {
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { items: { include: { product: true } }, user: { select: { name: true } } },
    });
    res.json(quote);
  } catch (err) { next(err); }
});

// POST /api/quotes — crear cotización
router.post('/',
  body('clientName').trim().notEmpty(),
  body('items').isArray({ min: 1 }),
  body('items.*.productId').isInt(),
  body('items.*.qty').isInt({ min: 1 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const { clientName, clientRfc, clientEmail, clientPhone,
              items, notes, validUntil } = req.body;

      const productIds = items.map(i => i.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
      });
      const productMap = new Map(products.map(p => [p.id, p]));

      const quoteItems = items.map(item => {
        const product = productMap.get(item.productId);
        if (!product) throw Object.assign(new Error(`Producto ${item.productId} no encontrado`), { status: 400 });
        const unitPrice = parseFloat(product.price);
        const subtotal = unitPrice * item.qty;
        return { productId: item.productId, qty: item.qty, unitPrice, subtotal };
      });

      const subtotal = quoteItems.reduce((a, i) => a + i.subtotal, 0);
      const tax = Math.round(subtotal * 0.16 * 100) / 100;
      const total = subtotal + tax;
      const folio = await nextFolio();

      const quote = await prisma.quote.create({
        data: {
          folio, clientName, clientRfc, clientEmail, clientPhone,
          subtotal, tax, total, notes,
          validUntil: validUntil ? new Date(validUntil) : null,
          userId: req.user.id,
          items: { create: quoteItems },
        },
        include: { items: { include: { product: { select: { name: true, sku: true, unit: true } } } } },
      });

      res.status(201).json(quote);
    } catch (err) { next(err); }
  }
);

// PUT /api/quotes/:id/status — cambiar estado
router.put('/:id/status',
  body('status').isIn(['PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']),
  async (req, res, next) => {
    try {
      const quote = await prisma.quote.update({
        where: { id: parseInt(req.params.id) },
        data: { status: req.body.status },
      });
      res.json(quote);
    } catch (err) { next(err); }
  }
);

// GET /api/quotes/:id/pdf — descargar PDF
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { items: { include: { product: { select: { name: true, sku: true, unit: true } } } } },
    });
    const pdfBytes = await quotePdf.generate(quote);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cotizacion-${quote.folio}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) { next(err); }
});

// POST /api/quotes/:id/send — enviar por correo
router.post('/:id/send', async (req, res, next) => {
  try {
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { items: { include: { product: { select: { name: true, unit: true } } } } },
    });
    if (!quote.clientEmail) return res.status(400).json({ error: 'El cliente no tiene correo registrado' });

    const pdfBytes = await quotePdf.generate(quote);
    await mailer.sendQuote(quote, pdfBytes);
    await prisma.quote.update({ where: { id: quote.id }, data: { status: 'SENT' } });
    res.json({ message: `Cotización enviada a ${quote.clientEmail}` });
  } catch (err) { next(err); }
});

// POST /api/quotes/:id/to-sale — convertir cotización en venta
router.post('/:id/to-sale', async (req, res, next) => {
  try {
    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { items: { include: { product: true } } },
    });

    // Verificar stock
    for (const item of quote.items) {
      if (item.product.stock < item.qty) {
        return res.status(400).json({
          error: `Stock insuficiente para "${item.product.name}". Disponible: ${item.product.stock}`,
        });
      }
    }

    // Llamar internamente a la ruta de ventas usando el servicio
    const saleItems = quote.items.map(i => ({ productId: i.productId, qty: i.qty }));
    // Redirige a la lógica de creación de venta
    req.body = { items: saleItems, payMethod: req.body.payMethod || 'CASH',
                  notes: `Venta desde cotización ${quote.folio}` };

    // Marcar cotización como aceptada
    await prisma.quote.update({ where: { id: quote.id }, data: { status: 'ACCEPTED' } });

    // Delegar al controlador de ventas (llama el siguiente middleware de la ruta POST /sales)
    // En producción conviene extraer la lógica en un servicio compartido
    res.json({ message: 'Redirige al módulo de ventas con los items pre-cargados', items: saleItems });
  } catch (err) { next(err); }
});

module.exports = router;
