const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

/**
 * Genera el PDF de una cotización.
 * @param {Object} quote — objeto Quote con items incluidos
 * @returns {Uint8Array} bytes del PDF
 */
async function generate(quote) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Carta
  const { width, height } = page.getSize();

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const MARGIN = 50;
  const COL = width - MARGIN * 2;
  const GRAY = rgb(0.5, 0.5, 0.5);
  const BLACK = rgb(0, 0, 0);
  const ACCENT = rgb(0.17, 0.42, 0.83); // azul corporativo

  let y = height - MARGIN;

  // ── ENCABEZADO ────────────────────────────────────────────────────────────
  page.drawText(process.env.COMPANY_NAME || 'Ferretería El Clavo SA de CV', {
    x: MARGIN, y, font: fontBold, size: 14, color: ACCENT,
  });
  y -= 18;
  page.drawText(process.env.COMPANY_RFC || '', { x: MARGIN, y, font, size: 9, color: GRAY });
  page.drawText(process.env.COMPANY_ADDRESS || '', { x: MARGIN, y: y - 12, font, size: 9, color: GRAY });
  page.drawText(process.env.COMPANY_PHONE || '', { x: MARGIN, y: y - 24, font, size: 9, color: GRAY });

  // Folio + fecha (alineados a la derecha)
  const folioText = `Cotización: ${quote.folio}`;
  const folioW = fontBold.widthOfTextAtSize(folioText, 12);
  page.drawText(folioText, { x: width - MARGIN - folioW, y: height - MARGIN, font: fontBold, size: 12, color: BLACK });

  const dateText = `Fecha: ${new Date(quote.createdAt).toLocaleDateString('es-MX')}`;
  const dateW = font.widthOfTextAtSize(dateText, 9);
  page.drawText(dateText, { x: width - MARGIN - dateW, y: height - MARGIN - 16, font, size: 9, color: GRAY });

  if (quote.validUntil) {
    const vigText = `Vigente hasta: ${new Date(quote.validUntil).toLocaleDateString('es-MX')}`;
    const vigW = font.widthOfTextAtSize(vigText, 9);
    page.drawText(vigText, { x: width - MARGIN - vigW, y: height - MARGIN - 30, font, size: 9, color: GRAY });
  }

  y -= 50;

  // ── LÍNEA SEPARADORA ──────────────────────────────────────────────────────
  page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 1, color: ACCENT });
  y -= 20;

  // ── DATOS DEL CLIENTE ─────────────────────────────────────────────────────
  page.drawText('DATOS DEL CLIENTE', { x: MARGIN, y, font: fontBold, size: 9, color: ACCENT });
  y -= 14;
  page.drawText(quote.clientName, { x: MARGIN, y, font: fontBold, size: 11, color: BLACK });
  y -= 13;
  if (quote.clientRfc) {
    page.drawText(`RFC: ${quote.clientRfc}`, { x: MARGIN, y, font, size: 9, color: GRAY });
    y -= 11;
  }
  if (quote.clientPhone) {
    page.drawText(`Tel: ${quote.clientPhone}`, { x: MARGIN, y, font, size: 9, color: GRAY });
    y -= 11;
  }
  if (quote.clientEmail) {
    page.drawText(`Email: ${quote.clientEmail}`, { x: MARGIN, y, font, size: 9, color: GRAY });
    y -= 11;
  }
  y -= 16;

  // ── TABLA DE PRODUCTOS ────────────────────────────────────────────────────
  // Cabecera
  const cols = { desc: MARGIN, qty: 340, unit: 400, total: 490 };
  page.drawRectangle({ x: MARGIN, y: y - 2, width: COL, height: 18, color: ACCENT });
  page.drawText('Descripción',    { x: cols.desc + 4, y: y + 2, font: fontBold, size: 9, color: rgb(1,1,1) });
  page.drawText('Cant.',          { x: cols.qty,       y: y + 2, font: fontBold, size: 9, color: rgb(1,1,1) });
  page.drawText('P. Unitario',    { x: cols.unit,      y: y + 2, font: fontBold, size: 9, color: rgb(1,1,1) });
  page.drawText('Subtotal',       { x: cols.total,     y: y + 2, font: fontBold, size: 9, color: rgb(1,1,1) });
  y -= 20;

  // Filas
  for (const item of quote.items) {
    if (y < 150) {
      // En un sistema real: agregar nueva página
      break;
    }
    const name = item.product?.name || item.description || '';
    const truncated = name.length > 52 ? name.substring(0, 52) + '…' : name;
    page.drawText(truncated,           { x: cols.desc + 4, y, font, size: 9, color: BLACK });
    page.drawText(String(item.qty),    { x: cols.qty,       y, font, size: 9, color: BLACK });
    page.drawText(fmt(item.unitPrice), { x: cols.unit,      y, font, size: 9, color: BLACK });
    page.drawText(fmt(item.subtotal),  { x: cols.total,     y, font, size: 9, color: BLACK });
    y -= 14;

    page.drawLine({
      start: { x: MARGIN, y: y + 11 }, end: { x: width - MARGIN, y: y + 11 },
      thickness: 0.3, color: rgb(0.85, 0.85, 0.85),
    });
  }

  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 0.8, color: ACCENT });
  y -= 18;

  // ── TOTALES ───────────────────────────────────────────────────────────────
  const totX = 400;
  const valX = 545;
  const drawTotal = (label, value, bold = false) => {
    const f = bold ? fontBold : font;
    const lW = f.widthOfTextAtSize(label, bold ? 11 : 9);
    const vW = f.widthOfTextAtSize(value, bold ? 11 : 9);
    page.drawText(label, { x: valX - lW - 60, y, font: f, size: bold ? 11 : 9, color: bold ? BLACK : GRAY });
    page.drawText(value, { x: valX - vW,       y, font: f, size: bold ? 11 : 9, color: bold ? ACCENT : BLACK });
    y -= bold ? 20 : 14;
  };

  drawTotal('Subtotal:', fmt(quote.subtotal));
  drawTotal('IVA 16%:', fmt(quote.tax));
  drawTotal('TOTAL:', fmt(quote.total), true);

  // ── NOTAS ─────────────────────────────────────────────────────────────────
  if (quote.notes) {
    y -= 10;
    page.drawText('Notas:', { x: MARGIN, y, font: fontBold, size: 9, color: ACCENT });
    y -= 13;
    page.drawText(quote.notes, { x: MARGIN, y, font, size: 9, color: GRAY, maxWidth: COL });
  }

  // ── PIE ───────────────────────────────────────────────────────────────────
  page.drawLine({ start: { x: MARGIN, y: 60 }, end: { x: width - MARGIN, y: 60 }, thickness: 0.5, color: GRAY });
  page.drawText('Este documento no tiene validez fiscal.', { x: MARGIN, y: 46, font, size: 8, color: GRAY });
  page.drawText(process.env.COMPANY_EMAIL || '', { x: MARGIN, y: 35, font, size: 8, color: GRAY });

  return doc.save();
}

function fmt(n) {
  return '$' + parseFloat(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

module.exports = { generate };
