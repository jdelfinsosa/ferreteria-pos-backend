const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authorize } = require('../middleware/auth');
const prisma = new PrismaClient();

router.get('/', async (req, res, next) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { active: true },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(suppliers);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const s = await prisma.supplier.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { products: { select: { id: true, name: true, sku: true, stock: true } } },
    });
    res.json(s);
  } catch (err) { next(err); }
});

router.post('/',
  authorize('ADMIN'),
  body('name').trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
      const { name, contact, phone, email, address, rfc } = req.body;
      const supplier = await prisma.supplier.create({ data: { name, contact, phone, email, address, rfc } });
      res.status(201).json(supplier);
    } catch (err) { next(err); }
  }
);

router.put('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { name, contact, phone, email, address, rfc } = req.body;
    const supplier = await prisma.supplier.update({
      where: { id: parseInt(req.params.id) },
      data: { name, contact, phone, email, address, rfc },
    });
    res.json(supplier);
  } catch (err) { next(err); }
});

router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.supplier.update({ where: { id: parseInt(req.params.id) }, data: { active: false } });
    res.json({ message: 'Proveedor desactivado' });
  } catch (err) { next(err); }
});

module.exports = router;
