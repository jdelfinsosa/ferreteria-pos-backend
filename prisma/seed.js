const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // ── CATEGORÍAS ─────────────────────────────────────────────────────────
  const catNames = [
    'Herramientas manuales','Herramientas eléctricas','Plomería',
    'Electricidad','Fijación','Pinturas','Seguridad','Construcción',
  ];
  const categories = await Promise.all(
    catNames.map(name => prisma.category.upsert({ where:{name}, update:{}, create:{name} }))
  );
  const catMap = Object.fromEntries(categories.map(c => [c.name, c.id]));
  console.log(`✅ ${categories.length} categorías`);

  // ── PROVEEDORES ────────────────────────────────────────────────────────
  const sup1 = await prisma.supplier.upsert({
    where:{id:1}, update:{},
    create:{ name:'Distribuidora Veracruz SA de CV', contact:'Ing. Roberto Flores',
             phone:'229 555 1100', email:'ventas@disver.com.mx', rfc:'DVE850101AAA' },
  });
  const sup2 = await prisma.supplier.upsert({
    where:{id:2}, update:{},
    create:{ name:'Materiales del Golfo SA', contact:'Lic. Carmen Ríos',
             phone:'229 444 2200', email:'pedidos@matgolfo.com', rfc:'MGO920215BBB' },
  });
  console.log('✅ Proveedores');

  // ── USUARIOS ──────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where:{email:'admin@ferreteria.com'}, update:{},
    create:{ name:'Administrador', email:'admin@ferreteria.com',
             password: await bcrypt.hash('Admin1234!',12), role:'ADMIN' },
  });
  await prisma.user.upsert({
    where:{email:'cajero@ferreteria.com'}, update:{},
    create:{ name:'Cajero Principal', email:'cajero@ferreteria.com',
             password: await bcrypt.hash('Cajero123!',12), role:'CASHIER' },
  });
  console.log('✅ Usuarios  →  admin@ferreteria.com / Admin1234!');

  // ── PRODUCTOS ─────────────────────────────────────────────────────────
  const prods = [
    {sku:'HM-001',name:'Martillo carpintero 16oz',          cat:'Herramientas manuales',   cost:85,  price:149, stock:23,min:5, sup:sup1.id},
    {sku:'HM-002',name:'Desarmador plano juego 6 piezas',   cat:'Herramientas manuales',   cost:72,  price:120, stock:20,min:5, sup:sup1.id},
    {sku:'HM-003',name:'Pinzas de presión 10"',             cat:'Herramientas manuales',   cost:65,  price:110, stock:18,min:4, sup:sup1.id},
    {sku:'HM-004',name:'Llave ajustable 12"',               cat:'Herramientas manuales',   cost:95,  price:160, stock:15,min:4, sup:sup1.id},
    {sku:'HM-005',name:'Cinta métrica 5m',                  cat:'Herramientas manuales',   cost:40,  price:75,  stock:30,min:8, sup:sup1.id},
    {sku:'HE-001',name:'Taladro percutor 1/2" 800W',        cat:'Herramientas eléctricas', cost:620, price:980, stock:8, min:3, sup:sup1.id},
    {sku:'HE-002',name:'Esmeriladora angular 4.5"',         cat:'Herramientas eléctricas', cost:380, price:620, stock:6, min:2, sup:sup1.id},
    {sku:'HE-003',name:'Sierra caladora 500W',              cat:'Herramientas eléctricas', cost:540, price:850, stock:4, min:2, sup:sup1.id},
    {sku:'HE-004',name:'Lijadora orbital 1/4 hoja',         cat:'Herramientas eléctricas', cost:290, price:480, stock:5, min:2, sup:sup1.id},
    {sku:'PL-001',name:'Llave stilson 14"',                 cat:'Plomería',                cost:95,  price:165, stock:15,min:4, sup:sup2.id},
    {sku:'PL-002',name:'Tubo PVC 1/2" sanitario (6m)',      cat:'Plomería',                cost:45,  price:75,  stock:60,min:15,sup:sup2.id},
    {sku:'PL-003',name:'Tubo PVC 4" hidráulico (6m)',       cat:'Plomería',                cost:120, price:195, stock:40,min:10,sup:sup2.id},
    {sku:'PL-004',name:'Codo 90° PVC 1/2"',                cat:'Plomería',                cost:4,   price:9,   stock:200,min:50,sup:sup2.id},
    {sku:'PL-005',name:'Llave de paso esfera 1/2"',         cat:'Plomería',                cost:55,  price:95,  stock:35,min:10,sup:sup2.id},
    {sku:'EL-001',name:'Cable THW calibre 12 (m)',          cat:'Electricidad',            cost:12,  price:22,  stock:200,min:50,sup:sup2.id},
    {sku:'EL-002',name:'Cable THW calibre 10 (m)',          cat:'Electricidad',            cost:18,  price:32,  stock:150,min:40,sup:sup2.id},
    {sku:'EL-003',name:'Interruptor sencillo',              cat:'Electricidad',            cost:18,  price:35,  stock:0, min:10,sup:sup2.id},
    {sku:'EL-004',name:'Contacto doble polarizado',         cat:'Electricidad',            cost:22,  price:42,  stock:45,min:12,sup:sup2.id},
    {sku:'EL-005',name:'Centro de carga 4 circuitos',       cat:'Electricidad',            cost:320, price:520, stock:8, min:3, sup:sup2.id},
    {sku:'FJ-001',name:'Tornillo autorroscante 3/4" cj100', cat:'Fijación',                cost:28,  price:55,  stock:48,min:10,sup:sup1.id},
    {sku:'FJ-002',name:'Taquete plástico 1/4" bolsa 50',   cat:'Fijación',                cost:15,  price:30,  stock:80,min:20,sup:sup1.id},
    {sku:'FJ-003',name:'Clavo c/cabeza 2.5" kg',            cat:'Fijación',                cost:22,  price:45,  stock:35,min:10,sup:sup1.id},
    {sku:'FJ-004',name:'Varilla roscada 3/8" (m)',          cat:'Fijación',                cost:18,  price:32,  stock:50,min:15,sup:sup1.id},
    {sku:'PT-001',name:'Pintura vinílica blanca 19L',       cat:'Pinturas',                cost:280, price:450, stock:12,min:3, sup:sup2.id},
    {sku:'PT-002',name:'Pintura esmalte negro 1L',          cat:'Pinturas',                cost:65,  price:110, stock:18,min:5, sup:sup2.id},
    {sku:'PT-003',name:'Sellador acrílico blanco 1L',       cat:'Pinturas',                cost:45,  price:80,  stock:22,min:6, sup:sup2.id},
    {sku:'PT-004',name:'Thinner 1L',                        cat:'Pinturas',                cost:28,  price:50,  stock:30,min:8, sup:sup2.id},
    {sku:'SE-001',name:'Casco de seguridad industrial',     cat:'Seguridad',               cost:95,  price:160, stock:30,min:8, sup:sup1.id},
    {sku:'SE-002',name:'Lentes de protección claros',       cat:'Seguridad',               cost:32,  price:60,  stock:40,min:10,sup:sup1.id},
    {sku:'SE-003',name:'Guantes de carnaza par',            cat:'Seguridad',               cost:45,  price:85,  stock:25,min:8, sup:sup1.id},
    {sku:'CO-001',name:'Varilla corrugada 3/8" (12m)',      cat:'Construcción',            cost:185, price:290, stock:20,min:5, sup:sup2.id},
    {sku:'CO-002',name:'Bulto cemento 50kg',                cat:'Construcción',            cost:145, price:210, stock:50,min:15,sup:sup2.id},
    {sku:'CO-003',name:'Malla electrosoldada 6x6',          cat:'Construcción',            cost:280, price:420, stock:10,min:3, sup:sup2.id},
  ];

  for (const p of prods) {
    await prisma.product.upsert({
      where:{ sku: p.sku }, update:{ stock: p.stock },
      create:{
        sku:p.sku, name:p.name, unit:'Pieza',
        cost:p.cost, price:p.price, stock:p.stock, minStock:p.min,
        categoryId: catMap[p.cat], supplierId: p.sup,
      },
    });
  }
  console.log(`✅ ${prods.length} productos`);
  console.log('\n🎉 Seed completado');
  console.log('  Admin:   admin@ferreteria.com / Admin1234!');
  console.log('  Cajero:  cajero@ferreteria.com / Cajero123!');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
