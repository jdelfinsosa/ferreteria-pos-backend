const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authorize } = require('../middleware/auth');

const prisma = new PrismaClient();

// Genera folio correlativo: V-0001, V-0002...
async function nextFolio() {
  const last = await prisma.sale.findFirst({ orderBy: { id: 'desc' }, select: { folio: true } });
  const n = last ? parseInt(last.folio.split('-')[1]) + 1 : 1;
  return `V-${String(n).padStart(4, '0')}`;
}

// GET /api/sales  — historial paginado
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 30, from, to, status } = req.query;
    const where = {
      ...(status && { status }),
      ...(from || to ? {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to + 'T23:59:59') }),
        },
      } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          items: { include: { product: { select: { name: true, sku: true } } } },
          user: { select: { name: true } },
          invoice: { select: { folio: true, uuid: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.sale.count({ where }),
    ]);

    res.json({ items, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// GET /api/sales/:id
router.get('/:id', async (req, res, next) => {
  try {
    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: {
        items: { include: { product: true } },
        user: { select: { name: true, email: true } },
        invoice: true,
      },
    });
    res.json(sale);
  } catch (err) { next(err); }
});

// POST /api/sales  — crear venta y descontar inventario
router.post('/',
  body('items').isArray({ min: 1 }),
  body('items.*.productId').isInt(),
  body('items.*.qty').isInt({ min: 1 }),
  body('payMethod').optional().isIn(['CASH', 'CARD', 'TRANSFER']),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const { items, payMethod = 'CASH', notes } = req.body;

      // Verificar stock de todos los productos antes de proceder
      const products = await prisma.product.findMany({
        where: { id: { in: items.map(i => i.productId) }, active: true },
      });

      const productMap = new Map(products.map(p => [p.id, p]));
      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product) return res.status(400).json({ error: `Producto ${item.productId} no encontrado` });
        if (product.stock < item.qty) {
          return res.status(400).json({
            error: `Stock insuficiente para "${product.name}". Disponible: ${product.stock}`,
          });
        }
      }

      // Calcular totales
      const saleItems = items.map(item => {
        const product = productMap.get(item.productId);
        const unitPrice = parseFloat(product.price);
        const subtotal = unitPrice * item.qty;
        return { productId: item.productId, qty: item.qty, unitPrice, subtotal };
      });

      const subtotal = saleItems.reduce((a, i) => a + i.subtotal, 0);
      const tax = Math.round(subtotal * 0.16 * 100) / 100;
      const total = subtotal + tax;
      const folio = await nextFolio();

      // Transacción: crear venta + descontar stock + registrar movimientos
      const sale = await prisma.$transaction(async (tx) => {
        const newSale = await tx.sale.create({
          data: {
            folio, subtotal, tax, total,
            payMethod, notes,
            userId: req.user.id,
            items: { create: saleItems },
          },
          include: { items: { include: { product: { select: { name: true, sku: true } } } } },
        });

        for (const item of saleItems) {
          const product = productMap.get(item.productId);
          const newStock = product.stock - item.qty;
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: newStock },
          });
          await tx.stockMovement.create({
            data: {
              productId: item.productId, type: 'OUT',
              qty: item.qty, reason: `Venta ${folio}`,
              before: product.stock, after: newStock,
            },
          });
        }

        return newSale;
      });

      res.status(201).json(sale);
    } catch (err) { next(err); }
  }
);

// PUT /api/sales/:id/cancel  — cancelar venta y reponer stock
router.put('/:id/cancel', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    if (sale.status === 'CANCELLED') {
      return res.status(400).json({ error: 'La venta ya está cancelada' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.sale.update({ where: { id }, data: { status: 'CANCELLED' } });

      for (const item of sale.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        const newStock = product.stock + item.qty;
        await tx.product.update({ where: { id: item.productId }, data: { stock: newStock } });
        await tx.stockMovement.create({
          data: {
            productId: item.productId, type: 'RETURN',
            qty: item.qty, reason: `Cancelación ${sale.folio}`,
            before: product.stock, after: newStock,
          },
        });
      }
    });

    res.json({ message: `Venta ${sale.folio} cancelada y stock repuesto` });
  } catch (err) { next(err); }
});

module.exports = router;
