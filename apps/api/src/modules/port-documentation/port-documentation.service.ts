import { createHash, randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { dirname, extname, join } from 'path';
import * as XLSX from 'xlsx';
import type {
  BunkerInstructionsPreviewDto,
  OrderPortDocumentDto,
  PortDocumentAssetDto,
  PortDocumentationOrderContextDto,
  PortDocumentationSectionDto,
  PortGateListPersonnelDto,
} from '@fueld/types';
import { db } from '../../db';
import {
  orderPortDocuments,
  orders,
  places,
  portDocumentAssets,
  portGateListPersonnel,
  tenants,
} from '../../db/schema';
import { getOrderById } from '../orders/orders.service';

type GateListInput = {
  fullName: string;
  roleTitle: string;
  company: string;
  active?: boolean;
  notes?: string | null;
  placeId?: string | null;
};

type GeneratedDocumentResult = {
  document: OrderPortDocumentDto;
  fileName: string;
  mimeType: string;
};

type DownloadableFile = {
  filePath: string;
  fileName: string;
  mimeType: string;
};

function mapGateListPerson(row: typeof portGateListPersonnel.$inferSelect): PortGateListPersonnelDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    placeId: row.placeId ?? null,
    fullName: row.fullName,
    roleTitle: row.roleTitle,
    company: row.company,
    active: row.active,
    notes: row.notes ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPortDocumentAsset(row: typeof portDocumentAssets.$inferSelect): PortDocumentAssetDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    documentKind: row.documentKind,
    displayName: row.displayName,
    originalFileName: row.originalFileName,
    filePath: row.filePath,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    sha256Hex: row.sha256Hex,
    versionNumber: row.versionNumber,
    isCurrent: row.isCurrent,
    active: row.active,
    uploadedBy: row.uploadedBy ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapOrderPortDocument(row: typeof orderPortDocuments.$inferSelect): OrderPortDocumentDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    orderId: row.orderId,
    documentKind: row.documentKind,
    sourceType: row.sourceType,
    status: row.status,
    fileName: row.fileName,
    filePath: row.filePath,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    sha256Hex: row.sha256Hex,
    assetId: row.assetId ?? null,
    generatedBy: row.generatedBy ?? null,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    includedBy: row.includedBy ?? null,
    includedAt: row.includedAt?.toISOString() ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeCell(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  return text || '-';
}

function formatIsoDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

function sanitizeSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  return sanitized || 'file';
}

function buildUploadDbPath(relativePath: string): string {
  return `/${join('uploads', relativePath).replace(/\\/g, '/')}`;
}

function resolveStoredAbsolutePath(filePath: string): string {
  if (filePath.startsWith('/uploads/')) {
    return join(process.cwd(), filePath.slice(1));
  }
  if (filePath.startsWith('uploads/')) {
    return join(process.cwd(), filePath);
  }
  return join(process.cwd(), 'uploads', filePath.replace(/^\/+/, ''));
}

function buildBunkerInstructionsFileName(order: any): string {
  const orderNumber = sanitizeSegment(order.orderNumber ?? order.id ?? 'order');
  const vesselName = sanitizeSegment(order.vessel?.name ?? 'vessel');
  return `bunker-instructions_${orderNumber}_${vesselName}.xlsx`;
}

function buildGateListFileName(order: any): string {
  const orderNumber = sanitizeSegment(order.orderNumber ?? order.id ?? 'order');
  return `gate-list_${orderNumber}.xlsx`;
}

function buildPreviewWarnings(order: any): string[] {
  const warnings: string[] = [];
  if (!order.agent?.name) warnings.push('Agent is missing on the order.');
  if (!order.vessel?.name) warnings.push('Vessel is missing on the order.');
  if (!order.vessel?.imo) warnings.push('Vessel IMO is missing on the order.');
  if (!order.place?.name) warnings.push('Port/place is missing on the order.');
  if (!order.eta) warnings.push('ETA is missing on the order.');
  if (!Array.isArray(order.items) || order.items.length === 0) warnings.push('Add at least one line item before generating bunker instructions.');
  return warnings;
}

function buildBunkerInstructionsSections(order: any): PortDocumentationSectionDto[] {
  const productLines = Array.isArray(order.items)
    ? order.items.map((item: any, index: number) => ({
        label: `Product ${index + 1}`,
        value: `${normalizeCell(item.productType)} · ${normalizeCell(item.quantity)} ${normalizeCell(item.unit)}`,
      }))
    : [];

  return [
    {
      title: 'Order',
      fields: [
        { label: 'Order Number', value: normalizeCell(order.orderNumber) },
        { label: 'Client', value: normalizeCell(order.client?.name) },
        { label: 'Supplier', value: normalizeCell(order.supplier?.name) },
        { label: 'Agent', value: normalizeCell(order.agent?.name) },
        { label: 'Agent Contact', value: normalizeCell(order.agentContact?.name) },
      ],
    },
    {
      title: 'Vessel & Port',
      fields: [
        { label: 'Vessel', value: normalizeCell(order.vessel?.name) },
        { label: 'IMO', value: normalizeCell(order.vessel?.imo) },
        { label: 'Port', value: normalizeCell(order.place?.name) },
        { label: 'ETA', value: formatIsoDate(order.eta) },
        { label: 'ETD', value: formatIsoDate(order.etd) },
      ],
    },
    {
      title: 'Products',
      fields: productLines.length > 0 ? productLines : [{ label: 'Products', value: '-' }],
    },
    {
      title: 'Operational Notes',
      fields: [
        { label: 'Place Remark', value: normalizeCell(order.place?.orderRemark ?? order.placeRemark) },
        { label: 'Customer Note', value: normalizeCell(order.customerNote) },
        { label: 'Supplier Note', value: normalizeCell(order.supplierNote) },
      ],
    },
  ];
}

function buildBunkerInstructionsWorkbook(preview: BunkerInstructionsPreviewDto): Buffer {
  const rows: Array<Array<string>> = [];
  rows.push(['Bunker Instructions']);
  rows.push([]);

  for (const section of preview.sections) {
    rows.push([section.title]);
    for (const field of section.fields) {
      rows.push([field.label, field.value]);
    }
    rows.push([]);
  }

  if (preview.warnings.length > 0) {
    rows.push(['Warnings']);
    for (const warning of preview.warnings) {
      rows.push(['', warning]);
    }
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 28 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Bunker Instructions');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildGateListWorkbook(order: any, personnel: PortGateListPersonnelDto[]): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheetRows = personnel.map((person) => ({
    Name: person.fullName,
    Role: person.roleTitle,
    Company: person.company,
    Notes: person.notes ?? '',
    'Port Scope': person.placeId ? order.place?.name ?? 'Specific Port' : 'All Ports',
    'Order Number': order.orderNumber ?? order.id,
    Vessel: order.vessel?.name ?? '',
    Port: order.place?.name ?? '',
  }));
  const sheet = XLSX.utils.json_to_sheet(sheetRows.length > 0
    ? sheetRows
    : [{ Name: '', Role: '', Company: '', Notes: '', 'Port Scope': '', 'Order Number': order.orderNumber ?? order.id, Vessel: order.vessel?.name ?? '', Port: order.place?.name ?? '' }]);
  sheet['!cols'] = [
    { wch: 28 },
    { wch: 24 },
    { wch: 24 },
    { wch: 36 },
    { wch: 18 },
    { wch: 20 },
    { wch: 24 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Gate List');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function getOrderForPortDocumentation(tenantId: string, orderId: string): Promise<any> {
  await assertOrderBelongsToTenant(tenantId, orderId);
  const order = await getOrderById(orderId);
  if (!order) throw new Error('Order not found');
  return order as any;
}

async function supersedeExistingDocuments(tenantId: string, orderId: string, documentKind: string): Promise<void> {
  await db
    .update(orderPortDocuments)
    .set({ status: 'SUPERSEDED', supersededAt: new Date() })
    .where(and(
      eq(orderPortDocuments.tenantId, tenantId),
      eq(orderPortDocuments.orderId, orderId),
      eq(orderPortDocuments.documentKind, documentKind),
      eq(orderPortDocuments.status, 'ACTIVE'),
    ));
}

async function persistGeneratedOrderDocument(params: {
  tenantId: string;
  orderId: string;
  documentKind: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  dataSnapshotJson?: unknown;
  inputSnapshotJson?: unknown;
  generatedBy: string;
}): Promise<OrderPortDocumentDto> {
  await supersedeExistingDocuments(params.tenantId, params.orderId, params.documentKind);

  const safeFileName = sanitizeSegment(params.fileName);
  const relativePath = join('port-documents', sanitizeSegment(params.tenantId), sanitizeSegment(params.orderId), `${randomUUID()}-${safeFileName}`);
  const absolutePath = join(process.cwd(), 'uploads', relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, params.buffer);

  const [inserted] = await db.insert(orderPortDocuments).values({
    tenantId: params.tenantId,
    orderId: params.orderId,
    documentKind: params.documentKind,
    sourceType: 'GENERATED',
    status: 'ACTIVE',
    fileName: params.fileName,
    filePath: buildUploadDbPath(relativePath),
    mimeType: params.mimeType,
    fileSize: params.buffer.length,
    sha256Hex: createHash('sha256').update(params.buffer).digest('hex'),
    inputSnapshotJson: params.inputSnapshotJson ?? null,
    dataSnapshotJson: params.dataSnapshotJson ?? null,
    generatedBy: params.generatedBy,
    generatedAt: new Date(),
  }).returning();

  return mapOrderPortDocument(inserted);
}

async function getCurrentAsset(tenantId: string, documentKind: string): Promise<typeof portDocumentAssets.$inferSelect | null> {
  const [asset] = await db
    .select()
    .from(portDocumentAssets)
    .where(and(
      eq(portDocumentAssets.tenantId, tenantId),
      eq(portDocumentAssets.documentKind, documentKind),
      eq(portDocumentAssets.isCurrent, true),
      eq(portDocumentAssets.active, true),
    ))
    .orderBy(desc(portDocumentAssets.versionNumber))
    .limit(1);

  return asset ?? null;
}

async function listGateListPersonnelForOrder(tenantId: string, placeId: string | null | undefined): Promise<PortGateListPersonnelDto[]> {
  const rows = await db
    .select()
    .from(portGateListPersonnel)
    .where(and(
      eq(portGateListPersonnel.tenantId, tenantId),
      eq(portGateListPersonnel.active, true),
      placeId
        ? or(isNull(portGateListPersonnel.placeId), eq(portGateListPersonnel.placeId, placeId))
        : isNull(portGateListPersonnel.placeId),
    ))
    .orderBy(asc(portGateListPersonnel.fullName));

  return rows.map(mapGateListPerson);
}

export async function getPortDocumentationSettingsForTenant(tenantId: string): Promise<{ enabled: boolean }> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) throw new Error('Tenant not found');

  const settings = tenant.settings as { portDocumentationSettings?: { enabled?: boolean } } | null;
  return { enabled: settings?.portDocumentationSettings?.enabled === true };
}

export async function assertPortDocumentationEnabled(tenantId: string): Promise<void> {
  const settings = await getPortDocumentationSettingsForTenant(tenantId);
  if (!settings.enabled) throw new Error('Port Documentation is disabled for this deployment');
}

export async function listGateListPersonnel(tenantId: string): Promise<PortGateListPersonnelDto[]> {
  const rows = await db
    .select()
    .from(portGateListPersonnel)
    .where(eq(portGateListPersonnel.tenantId, tenantId))
    .orderBy(desc(portGateListPersonnel.active), asc(portGateListPersonnel.fullName));

  return rows.map(mapGateListPerson);
}

export async function createGateListPerson(tenantId: string, userId: string, input: GateListInput): Promise<PortGateListPersonnelDto> {
  const [created] = await db.insert(portGateListPersonnel).values({
    tenantId,
    placeId: input.placeId ?? null,
    fullName: input.fullName.trim(),
    roleTitle: input.roleTitle.trim(),
    company: input.company.trim(),
    active: input.active ?? true,
    notes: input.notes?.trim() ? input.notes.trim() : null,
    createdBy: userId,
    updatedBy: userId,
    deactivatedAt: input.active === false ? new Date() : null,
  }).returning();

  return mapGateListPerson(created);
}

export async function updateGateListPerson(tenantId: string, userId: string, id: string, input: Partial<GateListInput>): Promise<PortGateListPersonnelDto> {
  const [existing] = await db
    .select()
    .from(portGateListPersonnel)
    .where(and(eq(portGateListPersonnel.id, id), eq(portGateListPersonnel.tenantId, tenantId)))
    .limit(1);

  if (!existing) throw new Error('Gate list person not found');

  const active = input.active ?? existing.active;
  const [updated] = await db
    .update(portGateListPersonnel)
    .set({
      placeId: input.placeId !== undefined ? input.placeId ?? null : existing.placeId,
      fullName: input.fullName !== undefined ? input.fullName.trim() : existing.fullName,
      roleTitle: input.roleTitle !== undefined ? input.roleTitle.trim() : existing.roleTitle,
      company: input.company !== undefined ? input.company.trim() : existing.company,
      active,
      notes: input.notes !== undefined ? (input.notes?.trim() ? input.notes.trim() : null) : existing.notes,
      updatedBy: userId,
      updatedAt: new Date(),
      deactivatedAt: active ? null : (existing.deactivatedAt ?? new Date()),
    })
    .where(and(eq(portGateListPersonnel.id, id), eq(portGateListPersonnel.tenantId, tenantId)))
    .returning();

  return mapGateListPerson(updated);
}

export async function listPortDocumentAssets(tenantId: string, documentKind?: string): Promise<PortDocumentAssetDto[]> {
  const rows = await db
    .select()
    .from(portDocumentAssets)
    .where(documentKind
      ? and(eq(portDocumentAssets.tenantId, tenantId), eq(portDocumentAssets.documentKind, documentKind))
      : eq(portDocumentAssets.tenantId, tenantId))
    .orderBy(desc(portDocumentAssets.isCurrent), desc(portDocumentAssets.versionNumber), desc(portDocumentAssets.createdAt));

  return rows.map(mapPortDocumentAsset);
}

export async function uploadPortDocumentAsset(params: {
  tenantId: string;
  userId: string;
  documentKind: string;
  displayName: string;
  file: File;
}): Promise<PortDocumentAssetDto> {
  const latest = await getCurrentAsset(params.tenantId, params.documentKind);
  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  const extension = extname(params.file.name) || '.bin';
  const relativePath = join('port-document-assets', sanitizeSegment(params.tenantId), sanitizeSegment(params.documentKind.toLowerCase()), `v${String(versionNumber).padStart(3, '0')}-${randomUUID()}${extension}`);
  const absolutePath = join(process.cwd(), 'uploads', relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, params.file);

  const fileBuffer = Buffer.from(await params.file.arrayBuffer());
  const sha256Hex = createHash('sha256').update(fileBuffer).digest('hex');

  await db
    .update(portDocumentAssets)
    .set({ isCurrent: false, supersededAt: new Date() })
    .where(and(
      eq(portDocumentAssets.tenantId, params.tenantId),
      eq(portDocumentAssets.documentKind, params.documentKind),
      eq(portDocumentAssets.isCurrent, true),
    ));

  const [inserted] = await db.insert(portDocumentAssets).values({
    tenantId: params.tenantId,
    documentKind: params.documentKind,
    displayName: params.displayName,
    originalFileName: params.file.name,
    filePath: buildUploadDbPath(relativePath),
    mimeType: params.file.type || 'application/octet-stream',
    fileSize: params.file.size,
    sha256Hex,
    versionNumber,
    isCurrent: true,
    active: true,
    uploadedBy: params.userId,
  }).returning();

  return mapPortDocumentAsset(inserted);
}

export async function downloadPortDocumentAsset(tenantId: string, assetId: string): Promise<DownloadableFile> {
  const [asset] = await db
    .select()
    .from(portDocumentAssets)
    .where(and(eq(portDocumentAssets.id, assetId), eq(portDocumentAssets.tenantId, tenantId)))
    .limit(1);

  if (!asset) throw new Error('Port document asset not found');

  return {
    filePath: asset.filePath,
    fileName: asset.originalFileName,
    mimeType: asset.mimeType,
  };
}

export async function getPortDocumentationOrderContext(tenantId: string, orderId: string): Promise<PortDocumentationOrderContextDto> {
  const order = await getOrderForPortDocumentation(tenantId, orderId);
  const settings = await getPortDocumentationSettingsForTenant(tenantId);
  const [gateCountRow] = await db
    .select({ count: db.$count(portGateListPersonnel) })
    .from(portGateListPersonnel)
    .where(and(eq(portGateListPersonnel.tenantId, tenantId), eq(portGateListPersonnel.active, true)));

  const currentFlangeWorksheet = await getCurrentAsset(tenantId, 'FLANGE_WORKSHEET');
  const documents = await db
    .select()
    .from(orderPortDocuments)
    .where(and(eq(orderPortDocuments.tenantId, tenantId), eq(orderPortDocuments.orderId, orderId)))
    .orderBy(desc(orderPortDocuments.createdAt));

  return {
    orderId,
    enabled: settings.enabled,
    gateListCount: gateCountRow?.count ?? 0,
    currentFlangeWorksheet: currentFlangeWorksheet ? mapPortDocumentAsset(currentFlangeWorksheet) : null,
    readinessWarnings: buildPreviewWarnings(order),
    documents: documents.map(mapOrderPortDocument),
  };
}

export async function getBunkerInstructionsPreview(tenantId: string, orderId: string): Promise<BunkerInstructionsPreviewDto> {
  const order = await getOrderForPortDocumentation(tenantId, orderId);
  return {
    orderId,
    warnings: buildPreviewWarnings(order),
    sections: buildBunkerInstructionsSections(order),
  };
}

export async function generateBunkerInstructionsDocument(tenantId: string, orderId: string, userId: string): Promise<GeneratedDocumentResult> {
  const order = await getOrderForPortDocumentation(tenantId, orderId);
  const preview = {
    orderId,
    warnings: buildPreviewWarnings(order),
    sections: buildBunkerInstructionsSections(order),
  } satisfies BunkerInstructionsPreviewDto;
  const buffer = buildBunkerInstructionsWorkbook(preview);
  const fileName = buildBunkerInstructionsFileName(order);
  const document = await persistGeneratedOrderDocument({
    tenantId,
    orderId,
    documentKind: 'BUNKER_INSTRUCTIONS',
    fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
    generatedBy: userId,
    inputSnapshotJson: { warnings: preview.warnings },
    dataSnapshotJson: { sections: preview.sections },
  });

  return {
    document,
    fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

export async function generateGateListDocument(tenantId: string, orderId: string, userId: string): Promise<GeneratedDocumentResult> {
  const order = await getOrderForPortDocumentation(tenantId, orderId);
  const personnel = await listGateListPersonnelForOrder(tenantId, order.placeId ?? null);
  const buffer = buildGateListWorkbook(order, personnel);
  const fileName = buildGateListFileName(order);
  const document = await persistGeneratedOrderDocument({
    tenantId,
    orderId,
    documentKind: 'GATE_LIST',
    fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
    generatedBy: userId,
    dataSnapshotJson: { personnel },
    inputSnapshotJson: { placeId: order.placeId ?? null },
  });

  return {
    document,
    fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

export async function includeFlangeWorksheet(tenantId: string, orderId: string, userId: string): Promise<OrderPortDocumentDto> {
  await getOrderForPortDocumentation(tenantId, orderId);
  const asset = await getCurrentAsset(tenantId, 'FLANGE_WORKSHEET');
  if (!asset) throw new Error('No current Flange Worksheet is uploaded');

  await supersedeExistingDocuments(tenantId, orderId, 'FLANGE_WORKSHEET');
  const [inserted] = await db.insert(orderPortDocuments).values({
    tenantId,
    orderId,
    documentKind: 'FLANGE_WORKSHEET',
    sourceType: 'STATIC_ASSET',
    status: 'ACTIVE',
    assetId: asset.id,
    fileName: asset.originalFileName,
    filePath: asset.filePath,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize,
    sha256Hex: asset.sha256Hex,
    dataSnapshotJson: { assetVersionNumber: asset.versionNumber },
    includedBy: userId,
    includedAt: new Date(),
  }).returning();

  return mapOrderPortDocument(inserted);
}

export async function downloadOrderPortDocument(tenantId: string, orderId: string, documentId: string): Promise<DownloadableFile> {
  const [document] = await db
    .select()
    .from(orderPortDocuments)
    .where(and(
      eq(orderPortDocuments.id, documentId),
      eq(orderPortDocuments.tenantId, tenantId),
      eq(orderPortDocuments.orderId, orderId),
    ))
    .limit(1);

  if (!document) throw new Error('Port document not found');

  return {
    filePath: document.filePath,
    fileName: document.fileName,
    mimeType: document.mimeType,
  };
}

export async function listPortDocumentationPlaces(): Promise<Array<{ id: string; name: string }>> {
  const rows = await db
    .select({ id: places.id, name: places.name })
    .from(places)
    .orderBy(asc(places.name));

  return rows;
}

export function getPortDocumentAbsolutePath(filePath: string): string {
  return resolveStoredAbsolutePath(filePath);
}

async function assertOrderBelongsToTenant(tenantId: string, orderId: string): Promise<void> {
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .limit(1);

  if (!order) throw new Error('Order not found');
}