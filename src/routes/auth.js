const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const prisma = new PrismaClient();

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

// POST /api/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || !user.active) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

      const token = signToken(user.id);
      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    } catch (err) { next(err); }
  }
);

// POST /api/auth/register  (solo ADMIN puede crear usuarios)
router.post('/register',
  authenticate, authorize('ADMIN'),
  body('name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['ADMIN', 'CASHIER', 'VIEWER']),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const { name, email, password, role } = req.body;
      const hash = await bcrypt.hash(password, 12);

      const user = await prisma.user.create({
        data: { name, email, password: hash, role },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      res.status(201).json(user);
    } catch (err) { next(err); }
  }
);

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

// PUT /api/auth/password  — cambiar contraseña propia
router.put('/password',
  authenticate,
  body('current').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const { current, newPassword } = req.body;
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      const valid = await bcrypt.compare(current, user.password);
      if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

      const hash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({ where: { id: req.user.id }, data: { password: hash } });
      res.json({ message: 'Contraseña actualizada' });
    } catch (err) { next(err); }
  }
);

module.exports = router;
