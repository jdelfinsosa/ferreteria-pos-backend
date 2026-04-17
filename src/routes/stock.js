const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authorize } = require('../middleware/auth');

const prisma = new PrismaClient();

// POST /api/stock/adjust — ajuste manual de inventario
router.post('/adjust',
  authorize('ADMIN', 'CASHIER'),
  body('productId').isInt(),
  body('qty').isInt(),        // positivo = entrada, negativo = salida
  body('reason').trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const { productId, qty, reason } = req.body;
      const product = await prisma.product.findUniqueOrThrow({ where: { id: parseInt(productId) } });

      const newStock = product.stock + parseInt(qty);
      if (newStock < 0) {
        return res.status(400).json({ error: `Stock insuficiente. Actual: ${product.stock}` });
      }

      const [updatedProduct, movement] = await prisma.$transaction([
        prisma.product.update({
          where: { id: product.id },
          data: { stock: newStock },
        }),
        prisma.stockMovement.create({
          data: {
            productId: product.id,
            type: 'ADJUST',
            qty: Math.abs(parseInt(qty)),
            reason,
            before: product.stock,
            after: newStock,
          },
        }),
      ]);

      res.json({ product: updatedProduct, movement });
    } catch (err) { next(err); }
  }
);

// GET /api/stock/movements/:productId — historial de movimientos
router.get('/movements/:productId', async (req, res, next) => {
  try {
    const movements = await prisma.stockMovement.findMany({
      where: { productId: parseInt(req.params.productId) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(movements);
  } catch (err) { next(err); }
});

// POST /api/stock/purchase — entrada masiva por compra a proveedor
router.post('/purchase',
  authorize('ADMIN'),
  body('items').isArray({ min: 1 }),
  body('items.*.productId').isInt(),
  body('items.*.qty').isInt({ min: 1 }),
  body('supplierId').optional().isInt(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const { items, supplierId, notes } = req.body;
      const reason = `Compra a proveedor${supplierId ? ' #' + supplierId : ''}${notes ? ' — ' + notes : ''}`;

      const results = await prisma.$transaction(async (tx) => {
        const movements = [];
        for (const item of items) {
          const product = await tx.product.findUniqueOrThrow({ where: { id: parseInt(item.productId) } });
          const newStock = product.stock + parseInt(item.qty);
          await tx.product.update({ where: { id: product.id }, data: { stock: newStock } });
          const movement = await tx.stockMovement.create({
            data: {
              productId: product.id, type: 'IN',
              qty: parseInt(item.qty), reason,
              before: product.stock, after: newStock,
            },
          });
          movements.push(movement);
        }
        return movements;
      });

      res.status(201).json({ message: `${results.length} productos actualizados`, movements: results });
    } catch (err) { next(err); }
  }
);

module.exports = router;
