/**
 * Seed script — Populates the local dev database with realistic test data.
 *
 * Usage:  bun run src/db/seed.ts
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { hashPassword } from '../modules/auth/password.service';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://fueld:fueld@localhost:5432/fueld';

const sql = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(sql, { schema });

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

const now = new Date();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════════════

async function seed() {
  console.log('🌱 Seeding database...\n');

  const seedMode = (process.env['SEED_MODE'] ?? 'full').toLowerCase();

  // ─── 1. Tenant ─────────────────────────────────────────────────────
  const tenantName = process.env['TENANT_NAME'] ?? 'Fueld Trading';
  const tenantDomain = process.env['TENANT_DOMAIN'] ?? 'fueld.io';
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: tenantName,
      domain: tenantDomain,
    })
    .returning();
  console.log(`  ✓ Tenant: ${tenant.name} (${tenant.id})`);

  // ─── 2. Users ──────────────────────────────────────────────────────
  const defaultPassword = await hashPassword('password123');
  const rawAdminPassword = process.env['ADMIN_PASSWORD'];
  if (!rawAdminPassword) {
    console.error('❌ ADMIN_PASSWORD environment variable is required');
    console.error('   Set it in /opt/fueld/.env or pass it directly:');
    console.error('   ADMIN_PASSWORD=mypassword bun run src/db/seed.ts');
    process.exit(1);
  }
  const adminPassword = await hashPassword(rawAdminPassword);

  // Production admin user
  const [prodAdmin] = await db
    .insert(schema.users)
    .values({
      tenantId: tenant.id,
      email: 'admin@fueld.app',
      name: 'Admin',
      role: 'ADMIN',
      passwordHash: adminPassword,
    })
    .returning();
  console.log(`  ✓ Production admin: admin@fueld.app`);

  if (seedMode === 'admin') {
    console.log('\n✅ Admin-only seed complete.');
    console.log('  Login credentials:');
    console.log('  ┌────────────────────────┬─────────────┬─────────┐');
    console.log('  │ Email                  │ Password    │ Role    │');
    console.log('  ├────────────────────────┼─────────────┼─────────┤');
    console.log('  │ admin@fueld.app        │ (provided)  │ ADMIN   │');
    console.log('  └────────────────────────┴─────────────┴─────────┘');
    await sql.end();
    process.exit(0);
  }

  const [admin] = await db
    .insert(schema.users)
    .values({
      tenantId: tenant.id,
      email: 'patrick@sikr.ai',
      name: 'Patrick Nielsen',
      role: 'ADMIN',
      passwordHash: defaultPassword,
    })
    .returning();

  const [trader1] = await db
    .insert(schema.users)
    .values({
      tenantId: tenant.id,
      email: 'jane@fueld.io',
      name: 'Jane Smith',
      role: 'TRADER',
      passwordHash: defaultPassword,
    })
    .returning();

  const [trader2] = await db
    .insert(schema.users)
    .values({
      tenantId: tenant.id,
      email: 'john@fueld.io',
      name: 'John Doe',
      role: 'TRADER',
      passwordHash: defaultPassword,
    })
    .returning();

  const [finance] = await db
    .insert(schema.users)
    .values({
      tenantId: tenant.id,
      email: 'ops@fueld.io',
      name: 'Emily White',
      role: 'FINANCE',
      passwordHash: defaultPassword,
    })
    .returning();

  console.log(`  ✓ Users: ${[admin, trader1, trader2, finance].map((u) => u.name).join(', ')}`);
  console.log(`    → All passwords: password123`);

  // ─── 3. Places ─────────────────────────────────────────────────────
  const placesData = [
    { name: 'Singapore',  country: 'SGP', countryIso: 'SGP', area: 'Far East',         placeType: 'POR' as const, lat: 1.2644,   long: 103.8222, unlocode: 'SG SIN', lliPlaceId: '15007' },
    { name: 'Fujairah',   country: 'ARE', countryIso: 'ARE', area: 'Arabian Gulf',     placeType: 'POR' as const, lat: 25.1288,  long: 56.3264,  unlocode: 'AE FJR', lliPlaceId: '11375' },
    { name: 'Rotterdam',  country: 'NLD', countryIso: 'NLD', area: 'N Cont Europe',    placeType: 'POR' as const, lat: 51.9496,  long: 4.1453,   unlocode: 'NL RTM', lliPlaceId: '1830'  },
    { name: 'Houston',    country: 'USA', countryIso: 'USA', area: 'US Gulf',          placeType: 'POR' as const, lat: 29.7604,  long: -95.3698, unlocode: 'US HOU', lliPlaceId: '18316' },
    { name: 'Hong Kong',  country: 'HKG', countryIso: 'HKG', area: 'Far East',         placeType: 'POR' as const, lat: 22.3193,  long: 114.1694, unlocode: 'HK HKG', lliPlaceId: '11654' },
    { name: 'Piraeus',    country: 'GRC', countryIso: 'GRC', area: 'E Mediterranean',  placeType: 'POR' as const, lat: 37.9475,  long: 23.6372,  unlocode: 'GR PIR', lliPlaceId: '14144' },
  ];
  const places = await db.insert(schema.places).values(placesData).returning();
  console.log(`  ✓ Places: ${places.map((p) => p.name).join(', ')}`);


  // ─── 4. Vessels ────────────────────────────────────────────────────
  const vesselsData = [
    { name: 'MV Neptune', imo: '9876543', flag: 'PA' },
    { name: 'MV Horizon', imo: '9876544', flag: 'LR' },
    { name: 'MV Voyager', imo: '9876545', flag: 'MH' },
    { name: 'MV Titan', imo: '9876546', flag: 'MT' },
    { name: 'MV Aurora', imo: '9876547', flag: 'GR' },
    { name: 'MV Pacific Star', imo: '9876548', flag: 'SG' },
  ];
  const vessels = await db.insert(schema.vessels).values(vesselsData).returning();
  console.log(`  ✓ Vessels: ${vessels.map((v) => v.name).join(', ')}`);

  // ─── 5. Counterparties ─────────────────────────────────────────────
  const clientsData = [
    { tenantId: tenant.id, name: 'Oceanic Logistics', type: 'CLIENT' as const, types: ['CLIENT'], creditLimit: '500000', country: 'SG' },
    { tenantId: tenant.id, name: 'Global Shipping Corp.', type: 'CLIENT' as const, types: ['CLIENT'], creditLimit: '750000', country: 'US' },
    { tenantId: tenant.id, name: 'Apex Maritime Solutions', type: 'CLIENT' as const, types: ['CLIENT'], creditLimit: '1000000', country: 'GR' },
    { tenantId: tenant.id, name: 'Nordic Tankers AS', type: 'CLIENT' as const, types: ['CLIENT'], creditLimit: '350000', country: 'NO' },
  ];
  const clients = await db.insert(schema.counterparties).values(clientsData).returning();

  const suppliersData = [
    { tenantId: tenant.id, name: 'Shell Marine Fuels', type: 'SUPPLIER' as const, types: ['SUPPLIER'], country: 'NL' },
    { tenantId: tenant.id, name: 'TotalEnergies Marine', type: 'SUPPLIER' as const, types: ['SUPPLIER'], country: 'FR' },
    { tenantId: tenant.id, name: 'Vitol Bunkers', type: 'SUPPLIER' as const, types: ['SUPPLIER'], country: 'CH' },
  ];
  const suppliers = await db.insert(schema.counterparties).values(suppliersData).returning();

  const brokersData = [
    { tenantId: tenant.id, name: 'Aegean Trading Brokers', type: 'BROKER' as const, types: ['BROKER'], country: 'GR' },
    { tenantId: tenant.id, name: 'Harbor Commercial Brokers', type: 'BROKER' as const, types: ['BROKER'], country: 'SG' },
  ];
  const brokers = await db.insert(schema.counterparties).values(brokersData).returning();

  const agentsData = [
    { tenantId: tenant.id, name: 'Portside Marine Agency', type: 'AGENT' as const, types: ['AGENT'], country: 'AE' },
    { tenantId: tenant.id, name: 'Bluewater Port Services', type: 'AGENT' as const, types: ['AGENT'], country: 'NL' },
  ];
  const agents = await db.insert(schema.counterparties).values(agentsData).returning();

  console.log(`  ✓ Counterparties: ${clients.length} clients, ${suppliers.length} suppliers, ${brokers.length} brokers, ${agents.length} agents`);

  // ─── 6. Orders ─────────────────────────────────────────────────────
  const ordersData = [
    // Active orders at various stages
    {
      tenantId: tenant.id,
      clientId: clients[0].id,
      vesselId: vessels[0].id,
      placeId: places[0].id,
      salesRepId: admin.id,
      status: 'INQUIRY' as const,
      eta: daysFromNow(10),
      supplierId: suppliers[1].id,
      supplierPaymentTermType: 'CREDIT' as const,
      supplierCreditDays: 30,
    },
    {
      tenantId: tenant.id,
      clientId: clients[1].id,
      vesselId: vessels[1].id,
      placeId: places[1].id,
      salesRepId: trader1.id,
      status: 'OFFER' as const,
      eta: daysFromNow(7),
      supplierId: suppliers[2].id,
      supplierPaymentTermType: 'COD' as const,
    },
    {
      tenantId: tenant.id,
      clientId: clients[2].id,
      vesselId: vessels[2].id,
      placeId: places[2].id,
      salesRepId: trader2.id,
      status: 'CONFIRMED' as const,
      eta: daysFromNow(3),
      supplierId: suppliers[1].id,
      supplierPaymentTermType: 'CREDIT' as const,
      supplierCreditDays: 15,
    },
    {
      tenantId: tenant.id,
      clientId: clients[0].id,
      vesselId: vessels[3].id,
      placeId: places[3].id,
      salesRepId: admin.id,
      status: 'DELIVERED' as const,
      eta: daysAgo(2),
      supplierId: suppliers[0].id,
      supplierPaymentTermType: 'PREPAY' as const,
    },
    {
      tenantId: tenant.id,
      clientId: clients[3].id,
      vesselId: vessels[4].id,
      placeId: places[4].id,
      salesRepId: trader1.id,
      status: 'INVOICED' as const,
      eta: daysAgo(10),
      supplierId: suppliers[2].id,
      supplierPaymentTermType: 'CREDIT' as const,
      supplierCreditDays: 30,
    },
    {
      tenantId: tenant.id,
      clientId: clients[1].id,
      vesselId: vessels[5].id,
      placeId: places[5].id,
      salesRepId: trader2.id,
      status: 'PAID' as const,
      eta: daysAgo(30),
      closedAt: daysAgo(5),
    },
    // Lost inquiry
    {
      tenantId: tenant.id,
      clientId: clients[2].id,
      vesselId: vessels[0].id,
      placeId: places[0].id,
      salesRepId: trader1.id,
      status: 'LOST' as const,
      lossReason: 'Price too high — client went with competitor',
      closedAt: daysAgo(15),
      supplierId: suppliers[0].id,
      supplierPaymentTermType: 'COD' as const,
    },
  ];
  const orders = await db.insert(schema.orders).values(ordersData).returning();
  console.log(`  ✓ Orders: ${orders.length} (INQUIRY→PAID + 1 CANCELLED)`);

  // ─── 7. Order Items ────────────────────────────────────────────────
  const orderItemsData = [
    // Order 0 — Inquiry
    { orderId: orders[0].id, productType: 'VLSFO' as const, quantity: '500.000', costPrice: '580.0000', salesPrice: '610.0000', profit: '15000.0000', paymentTerms: 'CREDIT_30' as const },
    // Order 1 — Offer
    { orderId: orders[1].id, productType: 'LSMGO' as const, quantity: '200.000', costPrice: '820.0000', salesPrice: '860.0000', profit: '8000.0000', paymentTerms: 'CREDIT_30' as const },
    // Order 2 — Confirmed
    { orderId: orders[2].id, productType: 'IFO380CST' as const, quantity: '1200.000', costPrice: '450.0000', salesPrice: '485.0000', profit: '42000.0000', paymentTerms: 'ON_RECEIPT' as const },
    { orderId: orders[2].id, productType: 'LSMGO' as const, quantity: '100.000', costPrice: '810.0000', salesPrice: '850.0000', profit: '4000.0000', paymentTerms: 'ON_RECEIPT' as const },
    // Order 3 — Delivered
    { orderId: orders[3].id, productType: 'VLSFO' as const, quantity: '800.000', costPrice: '575.0000', salesPrice: '605.0000', profit: '24000.0000', paymentTerms: 'CREDIT_30' as const },
    // Order 4 — Invoiced
    { orderId: orders[4].id, productType: 'MGO' as const, quantity: '300.000', costPrice: '890.0000', salesPrice: '940.0000', profit: '15000.0000', paymentTerms: 'CASH_ADVANCE' as const },
    // Order 5 — Paid
    { orderId: orders[5].id, productType: 'VLSFO' as const, quantity: '650.000', costPrice: '570.0000', salesPrice: '600.0000', profit: '19500.0000', paymentTerms: 'CREDIT_30' as const },
  ];
  const items = await db.insert(schema.orderItems).values(orderItemsData).returning();
  console.log(`  ✓ Order Items: ${items.length}`);

  // ─── 8. Invoices ───────────────────────────────────────────────────
  const invoicesData = [
    // Overdue invoices (for collections widget)
    {
      orderId: orders[3].id,
      invoiceNumber: 'INV-2026-0001',
      status: 'OVERDUE' as const,
      dueDate: daysAgo(22).toISOString().split('T')[0],
      amount: '125000.00',
      amountPaid: '0.00',
    },
    {
      orderId: orders[4].id,
      invoiceNumber: 'INV-2026-0005',
      status: 'OVERDUE' as const,
      dueDate: daysAgo(17).toISOString().split('T')[0],
      amount: '75500.00',
      amountPaid: '0.00',
    },
    // Paid invoice
    {
      orderId: orders[5].id,
      invoiceNumber: 'INV-2026-0012',
      status: 'PAID' as const,
      dueDate: daysAgo(35).toISOString().split('T')[0],
      amount: '210000.00',
      amountPaid: '210000.00',
    },
    // Draft invoice
    {
      orderId: orders[2].id,
      invoiceNumber: 'INV-2026-0018',
      status: 'DRAFT' as const,
      dueDate: daysFromNow(30).toISOString().split('T')[0],
      amount: '46200.00',
      amountPaid: '0.00',
    },
  ];
  const invoices = await db.insert(schema.invoices).values(invoicesData).returning();
  console.log(`  ✓ Invoices: ${invoices.length} (2 overdue, 1 paid, 1 draft)`);

  // ─── 9. Invoice Comments ──────────────────────────────────────────
  const commentsData = [
    {
      invoiceId: invoices[0].id,
      userId: trader1.id,
      comment: 'Followed up with client, awaiting payment approval from their CFO.',
      createdAt: daysAgo(3),
    },
    {
      invoiceId: invoices[0].id,
      userId: admin.id,
      comment: 'Escalated to credit control. Will call client directly tomorrow.',
      nextActionDate: daysFromNow(1).toISOString().split('T')[0],
      createdAt: daysAgo(1),
    },
    {
      invoiceId: invoices[1].id,
      userId: trader2.id,
      comment: 'Client requesting partial payment plan. Pending internal approval.',
      createdAt: daysAgo(5),
    },
  ];
  const comments = await db.insert(schema.invoiceComments).values(commentsData).returning();
  console.log(`  ✓ Invoice Comments: ${comments.length}`);

  // ─── 10. Audit Logs ────────────────────────────────────────────────
  const auditData = [
    { userId: admin.id, action: 'CREATE', entityType: 'ORDER', entityId: orders[0].id, changesJson: { status: 'INQUIRY' }, createdAt: daysAgo(20) },
    { userId: trader1.id, action: 'UPDATE', entityType: 'ORDER', entityId: orders[1].id, changesJson: { status: ['INQUIRY', 'OFFER'] }, createdAt: daysAgo(15) },
    { userId: trader2.id, action: 'UPDATE', entityType: 'ORDER', entityId: orders[2].id, changesJson: { status: ['OFFER', 'CONFIRMED'] }, createdAt: daysAgo(12) },
    { userId: admin.id, action: 'CREATE', entityType: 'INVOICE', entityId: invoices[0].id, changesJson: { invoiceNumber: 'INV-2026-0001' }, createdAt: daysAgo(22) },
  ];
  const logs = await db.insert(schema.auditLogs).values(auditData).returning();
  console.log(`  ✓ Audit Logs: ${logs.length}`);

  // ─── Done ──────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!\n');
  console.log('  Login credentials:');
  console.log('  ┌────────────────────────┬─────────────┬─────────┐');
  console.log('  │ Email                  │ Password    │ Role    │');
  console.log('  ├────────────────────────┼─────────────┼─────────┤');
  console.log('  │ patrick@sikr.ai        │ password123 │ ADMIN   │');
  console.log('  │ jane@fueld.io          │ password123 │ TRADER  │');
  console.log('  │ john@fueld.io          │ password123 │ TRADER  │');
  console.log('  │ ops@fueld.io           │ password123 │ OPERATOR│');
  console.log('  └────────────────────────┴─────────────┴─────────┘');

  await sql.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
