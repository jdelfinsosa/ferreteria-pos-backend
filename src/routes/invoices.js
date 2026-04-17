const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authorize } = require('../middleware/auth');
const Facturapi = require('facturapi').default;

const prisma = new PrismaClient();

// Instancia de Facturapi — usa llave de prueba en dev, producción en prod
function getFacturapi() {
  return new Facturapi(process.env.FACTURAPI_KEY);
}

async function nextFolio() {
  const last = await prisma.invoice.findFirst({ orderBy: { id: 'desc' }, select: { folio: true } });
  const n = last ? parseInt(last.folio.split('-')[1]) + 1 : 1;
  return `A-${String(n).padStart(4, '0')}`;
}

// GET /api/invoices
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, rfcReceptor } = req.query;
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          ...(status && { status }),
          ...(rfcReceptor && { rfcReceptor: { contains: rfcReceptor, mode: 'insensitive' } }),
        },
        include: { sale: { select: { folio: true } }, items: true },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.invoice.count(),
    ]);
    res.json({ items, total });
  } catch (err) { next(err); }
});

// GET /api/invoices/:id
router.get('/:id', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { items: true, sale: true },
    });
    res.json(invoice);
  } catch (err) { next(err); }
});

// POST /api/invoices — crear y timbrar factura CFDI 4.0
router.post('/',
  body('rfcReceptor').trim().notEmpty(),
  body('razonSocial').trim().notEmpty(),
  body('cpReceptor').trim().notEmpty(),
  body('cfdiUse').notEmpty(),
  body('payForm').notEmpty(),
  body('regimenFiscal').notEmpty(),
  body('items').isArray({ min: 1 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

      const {
        rfcReceptor, razonSocial, cpReceptor, cfdiUse,
        payForm, payMethod = 'PUE', regimenFiscal,
        items, saleId,
      } = req.body;

      // Calcular totales
      const invoiceItems = items.map(i => ({
        description: i.description,
        qty: parseFloat(i.qty),
        unitPrice: parseFloat(i.unitPrice),
        subtotal: parseFloat(i.qty) * parseFloat(i.unitPrice),
        taxRate: 0.16,
        taxAmount: parseFloat(i.qty) * parseFloat(i.unitPrice) * 0.16,
        claveUnidad: i.claveUnidad || 'H87',
        claveProdServ: i.claveProdServ || '31161500',
        productId: i.productId || null,
      }));

      const subtotal = invoiceItems.reduce((a, i) => a + i.subtotal, 0);
      const tax = invoiceItems.reduce((a, i) => a + i.taxAmount, 0);
      const total = subtotal + tax;
      const folio = await nextFolio();

      // ── Timbrar con Facturapi ───────────────────────────────────────────
      let uuid = null, xmlUrl = null, pdfUrl = null;
      try {
        const facturapi = getFacturapi();

        // Buscar o crear cliente en Facturapi
        let customer;
        const customers = await facturapi.customers.list({ q: rfcReceptor });
        if (customers.data.length > 0) {
          customer = customers.data[0];
        } else {
          customer = await facturapi.customers.create({
            legal_name: razonSocial,
            tax_id: rfcReceptor,
            tax_system: regimenFiscal,
            address: { zip: cpReceptor },
          });
        }

        const facturapiInvoice = await facturapi.invoices.create({
          customer: customer.id,
          payment_form: payForm,
          payment_method: payMethod,
          use: cfdiUse,
          items: invoiceItems.map(i => ({
            quantity: i.qty,
            product: {
              description: i.description,
              product_key: i.claveProdServ,
              unit_key: i.claveUnidad,
              price: i.unitPrice,
              tax_included: false,
              taxes: [{ type: 'IVA', rate: 0.16 }],
            },
          })),
        });

        uuid = facturapiInvoice.uuid;
        // Facturapi genera URLs de descarga
        xmlUrl = `https://api.facturapi.io/v2/invoices/${facturapiInvoice.id}/xml`;
        pdfUrl = `https://api.facturapi.io/v2/invoices/${facturapiInvoice.id}/pdf`;
      } catch (facErr) {
        // Si el PAC falla, guardamos como borrador
        console.error('Error Facturapi:', facErr.message);
      }

      // Guardar en BD
      const invoice = await prisma.invoice.create({
        data: {
          folio, rfcReceptor, razonSocial, cpReceptor,
          cfdiUse, payForm, payMethod, regimenFiscal,
          subtotal, tax, total,
          uuid, xmlUrl, pdfUrl,
          status: uuid ? 'STAMPED' : 'DRAFT',
          userId: req.user.id,
          saleId: saleId ? parseInt(saleId) : null,
          items: { create: invoiceItems },
        },
        include: { items: true },
      });

      res.status(201).json({
        ...invoice,
        timbrada: !!uuid,
        message: uuid ? `Factura ${folio} timbrada exitosamente` : `Factura ${folio} guardada como borrador (revisar PAC)`,
      });
    } catch (err) { next(err); }
  }
);

// POST /api/invoices/:id/cancel — cancelar ante SAT
router.post('/:id/cancel', authorize('ADMIN'), async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
    });

    if (!invoice.uuid) {
      return res.status(400).json({ error: 'La factura no tiene UUID (no fue timbrada)' });
    }
    if (invoice.status === 'CANCELLED') {
      return res.status(400).json({ error: 'La factura ya está cancelada' });
    }

    // Cancelar en Facturapi
    try {
      const facturapi = getFacturapi();
      // El UUID se usa para identificar la factura en el PAC
      // En Facturapi necesitas el ID interno del PAC, que se guarda en pacFolio
      if (invoice.pacFolio) {
        await facturapi.invoices.cancel(invoice.pacFolio, {
          motive: req.body.motive || '02', // 02 = comprobante emitido con errores sin relación
        });
      }
    } catch (facErr) {
      console.error('Error cancelación Facturapi:', facErr.message);
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'CANCELLED' },
    });

    res.json({ message: `Factura ${invoice.folio} cancelada` });
  } catch (err) { next(err); }
});

// GET /api/invoices/:id/pdf — descargar PDF
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
    });
    if (!invoice.pdfUrl) return res.status(404).json({ error: 'PDF no disponible' });
    // Proxy desde Facturapi con autenticación
    const facturapi = getFacturapi();
    const pdfStream = await facturapi.invoices.downloadPdf(invoice.pacFolio);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${invoice.folio}.pdf"`);
    pdfStream.pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;
