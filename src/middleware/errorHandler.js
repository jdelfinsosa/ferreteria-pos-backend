const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error(`${err.message} — ${req.method} ${req.path}`, { stack: err.stack });

  // Errores de Prisma
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Ya existe un registro con ese valor único', field: err.meta?.target });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Registro no encontrado' });
  }

  // Errores de validación (express-validator)
  if (err.type === 'validation') {
    return res.status(422).json({ error: 'Datos inválidos', details: err.errors });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Error interno del servidor' : err.message,
  });
}

module.exports = { errorHandler };
