const inquiryStoredDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function normalizeCellLabel(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTableRowPattern(label: string): RegExp {
  return new RegExp(
    `<tr[^>]*>\\s*<td[^>]*>\\s*${escapeRegExp(label)}\\s*</td>\\s*<td[^>]*>[\\s\\S]*?</td>\\s*</tr>`,
    'i',
  );
}

function upsertMetadataRowInHtml(
  html: string,
  label: string,
  value: string | null,
  beforeLabels: string[],
): string {
  const trimmedValue = value?.trim() ?? '';
  const rowPattern = buildTableRowPattern(label);

  if (!trimmedValue) {
    return html.replace(rowPattern, '');
  }

  const rowHtml = `<tr><td>${label}</td><td>${trimmedValue}</td></tr>`;
  if (rowPattern.test(html)) {
    return html.replace(rowPattern, rowHtml);
  }

  for (const beforeLabel of beforeLabels) {
    const beforePattern = buildTableRowPattern(beforeLabel);
    if (beforePattern.test(html)) {
      return html.replace(beforePattern, (match) => `${rowHtml}${match}`);
    }
  }

  return html.replace(/<\/table>/i, `${rowHtml}</table>`);
}

function findMetadataTable(root: ParentNode): HTMLTableElement | null {
  const tables = Array.from(root.querySelectorAll('table'));
  return tables.find((table) => {
    const rows = Array.from(table.rows);
    return rows.some((row) => rowHasLabel(row, 'Vessel:'))
      && rows.some((row) => rowHasLabel(row, 'Place:'));
  }) ?? null;
}

function normalizedRowText(row: HTMLTableRowElement): string {
  return normalizeCellLabel(row.textContent);
}

function rowHasLabel(row: HTMLTableRowElement, label: string): boolean {
  const firstCellLabel = normalizeCellLabel(row.cells[0]?.textContent);
  if (firstCellLabel === label) return true;

  const rowText = normalizedRowText(row);
  return rowText.startsWith(label);
}

function findRowByLabel(table: HTMLTableElement, label: string): HTMLTableRowElement | null {
  return Array.from(table.rows).find((row) => rowHasLabel(row, label)) ?? null;
}

function findFallbackMetadataElement(root: ParentNode, kind: string): HTMLElement | null {
  return root.querySelector(`[data-fueld-inquiry-meta="${kind}"]`);
}

function buildFallbackMetadataElement(kind: string, label: string, value: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.setAttribute('data-fueld-inquiry-meta', kind);
  element.style.margin = '0 0 16px';
  element.style.lineHeight = '1.65';
  element.style.color = '#111827';

  const strong = document.createElement('strong');
  strong.textContent = label;
  element.appendChild(strong);
  element.append(` ${value}`);
  return element;
}

function findFallbackInsertionAnchor(root: ParentNode): Element | null {
  const requestedItemsAnchor = Array.from(root.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6'))
    .find((element) => normalizeCellLabel(element.textContent).startsWith('Requested items'));
  if (requestedItemsAnchor) return requestedItemsAnchor;

  const freeformMetadataAnchor = Array.from(root.querySelectorAll('p, div'))
    .find((element) => {
      if (element.closest('table')) return false;
      const text = normalizeCellLabel(element.textContent);
      return text.startsWith('Reply within:') || text.startsWith('Account:');
    });
  if (freeformMetadataAnchor) return freeformMetadataAnchor;

  const tables = Array.from(root.querySelectorAll('table'));
  return tables[1] ?? null;
}

function syncFallbackMetadataBlock(
  root: ParentNode,
  kind: string,
  label: string,
  value: string | null,
): void {
  const trimmedValue = value?.trim() ?? '';
  const existing = findFallbackMetadataElement(root, kind);

  if (!trimmedValue) {
    existing?.remove();
    return;
  }

  const nextElement = buildFallbackMetadataElement(kind, label, trimmedValue);
  if (existing) {
    existing.replaceWith(nextElement);
    return;
  }

  const anchor = findFallbackInsertionAnchor(root);
  if (anchor?.parentNode) {
    anchor.parentNode.insertBefore(nextElement, anchor);
    return;
  }

  if (root instanceof HTMLElement) {
    root.appendChild(nextElement);
  }
}

function setRowValue(row: HTMLTableRowElement, label: string, value: string): void {
  while (row.cells.length < 2) row.insertCell();
  row.cells[0]!.textContent = label;
  row.cells[1]!.textContent = value;
}

function cloneRow(referenceRow: HTMLTableRowElement, label: string, value: string): HTMLTableRowElement {
  const row = referenceRow.cloneNode(true) as HTMLTableRowElement;
  setRowValue(row, label, value);
  return row;
}

function upsertMetadataRow(
  table: HTMLTableElement,
  label: string,
  value: string | null,
  referenceLabels: string[],
  beforeLabels: string[],
): void {
  const trimmedValue = value?.trim() ?? '';
  const existingRow = findRowByLabel(table, label);

  if (!trimmedValue) {
    existingRow?.remove();
    return;
  }

  if (existingRow) {
    setRowValue(existingRow, label, trimmedValue);
    return;
  }

  const referenceRow = referenceLabels
    .map((referenceLabel) => findRowByLabel(table, referenceLabel))
    .find((row): row is HTMLTableRowElement => !!row);
  if (!referenceRow) return;

  const newRow = cloneRow(referenceRow, label, trimmedValue);
  const parent = referenceRow.parentElement;
  if (!parent) return;

  const beforeRow = beforeLabels
    .map((beforeLabel) => findRowByLabel(table, beforeLabel))
    .find((row): row is HTMLTableRowElement => !!row);

  parent.insertBefore(newRow, beforeRow ?? referenceRow.nextSibling);
}

export function formatInquiryStoredDateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return inquiryStoredDateFormatter.format(date);
}

export function buildInquiryDeliveryWindowLabel(
  eta: string | null | undefined,
  etd: string | null | undefined,
): string {
  const etaLabel = formatInquiryStoredDateLabel(eta);
  const etdLabel = formatInquiryStoredDateLabel(etd);
  if (etaLabel && etdLabel) return `${etaLabel} to ${etdLabel}`;
  return etaLabel || etdLabel || '';
}

export function syncInquiryMetadataTable(
  html: string,
  options: { deliveryLabel?: string | null; responseDeadlineLabel?: string | null },
): string {
  if (!html.trim()) return html;

  if (typeof document === 'undefined') {
    let nextHtml = upsertMetadataRowInHtml(html, 'Delivery:', options.deliveryLabel ?? null, ['Reply within:', 'Account:']);
    nextHtml = upsertMetadataRowInHtml(nextHtml, 'Reply within:', options.responseDeadlineLabel ?? null, ['Account:']);
    return nextHtml;
  }

  const container = document.createElement('div');
  container.innerHTML = html;
  const table = findMetadataTable(container);
  if (table) {
    upsertMetadataRow(table, 'Delivery:', options.deliveryLabel ?? null, ['Place:', 'Account:'], ['Reply within:', 'Account:']);
    upsertMetadataRow(table, 'Reply within:', options.responseDeadlineLabel ?? null, ['Delivery:', 'Place:', 'Account:'], ['Account:']);
  }

  const containsDeliveryLabel = /(^|\s)Delivery:/i.test(container.textContent ?? '');
  if (!containsDeliveryLabel || findFallbackMetadataElement(container, 'delivery')) {
    syncFallbackMetadataBlock(container, 'delivery', 'Delivery:', options.deliveryLabel ?? null);
  }

  return container.innerHTML;
}