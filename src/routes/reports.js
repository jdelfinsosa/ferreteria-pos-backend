const router = require('express').Router();
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/reports/dashboard — resumen general
router.get('/dashboard', async (req, res, next) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [salesMonth, salesToday, totalProducts, lowStock, topProducts] = await Promise.all([
      // Ventas del mes
      prisma.sale.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { total: true, subtotal: true, tax: true },
        _count: { id: true },
      }),
      // Ventas de hoy
      prisma.sale.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfDay } },
        _sum: { total: true },
        _count: { id: true },
      }),
      // Total de productos activos
      prisma.product.count({ where: { active: true } }),
      // Productos con stock bajo
      prisma.product.count({ where: { active: true, stock: { lte: prisma.product.fields.minStock } } }),
      // Top 5 productos más vendidos (mes)
      prisma.saleItem.groupBy({
        by: ['productId'],
        where: { sale: { status: 'COMPLETED', createdAt: { gte: startOfMonth } } },
        _sum: { qty: true, subtotal: true },
        orderBy: { _sum: { qty: 'desc' } },
        take: 5,
      }),
    ]);

    // Enriquecer top products con nombre
    const topProductIds = topProducts.map(p => p.productId);
    const productNames = await prisma.product.findMany({
      where: { id: { in: topProductIds } },
      select: { id: true, name: true, sku: true },
    });
    const nameMap = new Map(productNames.map(p => [p.id, p]));

    const totalSales = parseFloat(salesMonth._sum.total || 0);
    // Calcular costo real del mes
    const costData = await prisma.$queryRaw`
      SELECT COALESCE(SUM(si.qty * p.cost), 0) as total_cost
      FROM sale_items si
      JOIN products p ON p.id = si."productId"
      JOIN sales s ON s.id = si."saleId"
      WHERE s.status = 'COMPLETED' AND s."createdAt" >= ${startOfMonth}
    `;
    const totalCost = parseFloat(costData[0]?.total_cost || 0);

    res.json({
      month: {
        sales: totalSales,
        cost: totalCost,
        grossProfit: totalSales - totalCost,
        margin: totalSales > 0 ? ((totalSales - totalCost) / totalSales * 100).toFixed(1) : 0,
        tax: parseFloat(salesMonth._sum.tax || 0),
        count: salesMonth._count.id,
      },
      today: {
        sales: parseFloat(salesToday._sum.total || 0),
        count: salesToday._count.id,
      },
      inventory: { total: totalProducts, lowStock },
      topProducts: topProducts.map(p => ({
        ...nameMap.get(p.productId),
        qtySold: p._sum.qty,
        revenue: parseFloat(p._sum.subtotal || 0),
      })),
    });
  } catch (err) { next(err); }
});

// GET /api/reports/sales-by-day?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/sales-by-day', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 864e5);
    const end = to ? new Date(to + 'T23:59:59') : new Date();

    const data = await prisma.$queryRaw`
      SELECT
        DATE(s."createdAt") as day,
        COUNT(s.id)::int as count,
        COALESCE(SUM(s.subtotal), 0)::float as subtotal,
        COALESCE(SUM(s.tax), 0)::float as tax,
        COALESCE(SUM(s.total), 0)::float as total
      FROM sales s
      WHERE s.status = 'COMPLETED'
        AND s."createdAt" >= ${start}
        AND s."createdAt" <= ${end}
      GROUP BY DATE(s."createdAt")
      ORDER BY day ASC
    `;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/reports/inventory-value — valor del inventario por categoría
router.get('/inventory-value', async (req, res, next) => {
  try {
    const data = await prisma.$queryRaw`
      SELECT
        c.name as category,
        COUNT(p.id)::int as products,
        SUM(p.stock)::int as totalStock,
        COALESCE(SUM(p.stock * p.cost), 0)::float as costValue,
        COALESCE(SUM(p.stock * p.price), 0)::float as saleValue
      FROM products p
      LEFT JOIN categories c ON c.id = p."categoryId"
      WHERE p.active = true
      GROUP BY c.name
      ORDER BY "costValue" DESC
    `;
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/reports/products-margin — margen por producto
router.get('/products-margin', async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { active: true },
      select: { id: true, sku: true, name: true, cost: true, price: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    const result = products.map(p => {
      const cost = parseFloat(p.cost);
      const price = parseFloat(p.price);
      const margin = price > 0 ? ((price - cost) / price * 100).toFixed(1) : 0;
      return { ...p, cost, price, margin: parseFloat(margin) };
    });

    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
