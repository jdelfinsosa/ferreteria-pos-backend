const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authorize } = require('../middleware/auth');

const prisma = new PrismaClient();

// GET /api/products  — listar con filtros y paginación
router.get('/', async (req, res, next) => {
  try {
    const {
      search, categoryId, supplierId,
      lowStock, active = 'true',
      page = 1, limit = 50,
      sortBy = 'name', sortDir = 'asc',
    } = req.query;

    const where = {
      active: active === 'true',
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search } },
        ],
      }),
      ...(categoryId && { categoryId: parseInt(categoryId) }),
      ...(supplierId && { supplierId: parseInt(supplierId) }),
      ...(lowStock === 'true' && { stock: { lte: prisma.product.fields.minStock } }),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true, supplier: { select: { id: true, name: true } } },
        orderBy: { [sortBy]: sortDir },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.product.count({ where }),
    ]);

    res.json({ items, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// GET /api/products/low-stock
router.get('/low-stock', async (req, res, next) => {
  try {
    const products = await prisma.$queryRaw`
      SELECT p.*, c.name as "categoryName"
      FROM products p
      LEFT JOIN categories c ON c.id = p."categoryId"
      WHERE p.active = true AND p.stock <= p."minStock"
      ORDER BY p.stock ASC
    `;
    res.json(products);
  } catch (err) { next(err); }
});

// GET /api/products/:id
router.get('/:id', async (req, res, next) => {
  try {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: {
        category: true,
        supplier: true,
        stockMovements: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    res.json(product);
  } catch (err) { next(err); }
});

// POST /api/products  (ADMIN o CASHIER)
router.post('/',
  authorize('ADMIN', 'CASHIER'),
  body('sku').trim().notEmpty(),
  body('name').trim().notEmpty(),
  body('cost').isFloat({ min: 0 }),
  body('price').isFloat({ min: 0 }),
  body('stock').isInt({ min: 0 }),
  body('minStock').optional().isInt({ min: 0 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const { sku, name, description, unit, cost, price, stock, minStock, maxStock,
              barcode, categoryId, supplierId } = req.body;

      const product = await prisma.product.create({
        data: {
          sku, name, description, unit: unit || 'Pieza',
          cost: parseFloat(cost), price: parseFloat(price),
          stock: parseInt(stock), minStock: parseInt(minStock || 5),
          maxStock: maxStock ? parseInt(maxStock) : null,
          barcode: barcode || null,
          categoryId: categoryId ? parseInt(categoryId) : null,
          supplierId: supplierId ? parseInt(supplierId) : null,
        },
        include: { category: true },
      });

      // Registrar movimiento inicial si hay stock
      if (product.stock > 0) {
        await prisma.stockMovement.create({
          data: {
            productId: product.id, type: 'IN',
            qty: product.stock, reason: 'Inventario inicial',
            before: 0, after: product.stock,
          },
        });
      }

      res.status(201).json(product);
    } catch (err) { next(err); }
  }
);

// PUT /api/products/:id
router.put('/:id',
  authorize('ADMIN', 'CASHIER'),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const { sku, name, description, unit, cost, price,
              minStock, maxStock, barcode, categoryId, supplierId } = req.body;

      const product = await prisma.product.update({
        where: { id },
        data: {
          ...(sku && { sku }),
          ...(name && { name }),
          description,
          ...(unit && { unit }),
          ...(cost !== undefined && { cost: parseFloat(cost) }),
          ...(price !== undefined && { price: parseFloat(price) }),
          ...(minStock !== undefined && { minStock: parseInt(minStock) }),
          ...(maxStock !== undefined && { maxStock: parseInt(maxStock) }),
          barcode: barcode || null,
          ...(categoryId !== undefined && { categoryId: categoryId ? parseInt(categoryId) : null }),
          ...(supplierId !== undefined && { supplierId: supplierId ? parseInt(supplierId) : null }),
        },
        include: { category: true, supplier: { select: { id: true, name: true } } },
      });
      res.json(product);
    } catch (err) { next(err); }
  }
);

// DELETE /api/products/:id  — soft delete (solo ADMIN)
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.product.update({
      where: { id: parseInt(req.params.id) },
      data: { active: false },
    });
    res.json({ message: 'Producto desactivado' });
  } catch (err) { next(err); }
});

module.exports = router;
