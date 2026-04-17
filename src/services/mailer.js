const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Envía cotización por correo con PDF adjunto
 */
async function sendQuote(quote, pdfBytes) {
  const transporter = createTransport();

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: quote.clientEmail,
    subject: `Cotización ${quote.folio} — ${process.env.COMPANY_NAME}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#2b5bbf">Cotización ${quote.folio}</h2>
        <p>Estimado/a <strong>${quote.clientName}</strong>,</p>
        <p>Adjuntamos la cotización solicitada con un total de 
          <strong style="color:#2b5bbf">$${parseFloat(quote.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</strong>.
        </p>
        ${quote.validUntil ? `<p>Esta cotización tiene vigencia hasta el <strong>${new Date(quote.validUntil).toLocaleDateString('es-MX')}</strong>.</p>` : ''}
        ${quote.notes ? `<p><em>Notas: ${quote.notes}</em></p>` : ''}
        <hr>
        <p style="color:#666;font-size:12px">
          ${process.env.COMPANY_NAME}<br>
          ${process.env.COMPANY_PHONE}<br>
          ${process.env.COMPANY_EMAIL}
        </p>
      </div>
    `,
    attachments: [{
      filename: `cotizacion-${quote.folio}.pdf`,
      content: Buffer.from(pdfBytes),
      contentType: 'application/pdf',
    }],
  });
}

/**
 * Envía factura por correo con PDF y XML adjuntos
 */
async function sendInvoice(invoice, pdfBuffer, xmlBuffer) {
  const transporter = createTransport();

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: invoice.email, // debe pasarse desde el controlador
    subject: `Factura ${invoice.folio} — ${process.env.COMPANY_NAME}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#2b5bbf">Factura Electrónica ${invoice.folio}</h2>
        <p>Adjuntamos su factura CFDI 4.0 con los archivos PDF y XML.</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:4px 8px;color:#666">UUID SAT:</td><td><strong>${invoice.uuid || 'Pendiente'}</strong></td></tr>
          <tr><td style="padding:4px 8px;color:#666">RFC Receptor:</td><td><strong>${invoice.rfcReceptor}</strong></td></tr>
          <tr><td style="padding:4px 8px;color:#666">Total:</td><td><strong style="color:#2b5bbf">$${parseFloat(invoice.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</strong></td></tr>
        </table>
        <hr>
        <p style="color:#666;font-size:12px">${process.env.COMPANY_NAME} — RFC: ${process.env.COMPANY_RFC}</p>
      </div>
    `,
    attachments: [
      ...(pdfBuffer ? [{ filename: `factura-${invoice.folio}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }] : []),
      ...(xmlBuffer ? [{ filename: `factura-${invoice.folio}.xml`, content: xmlBuffer, contentType: 'application/xml' }] : []),
    ],
  });
}

module.exports = { sendQuote, sendInvoice };
