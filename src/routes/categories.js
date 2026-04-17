// ─── categories.js ─────────────────────────────────────────────────────────
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authorize } = require('../middleware/auth');
const prisma = new PrismaClient();

router.get('/', async (req, res, next) => {
  try {
    const cats = await prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(cats);
  } catch (err) { next(err); }
});

router.post('/', authorize('ADMIN'), async (req, res, next) => {
  try {
    const cat = await prisma.category.create({ data: { name: req.body.name.trim() } });
    res.status(201).json(cat);
  } catch (err) { next(err); }
});

router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.category.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Categoría eliminada' });
  } catch (err) { next(err); }
});

module.exports = router;
