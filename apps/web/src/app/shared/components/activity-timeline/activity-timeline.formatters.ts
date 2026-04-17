export function formatMetadataLabel(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

export interface ActivityMetadataChangeRow {
  field: string;
  from?: unknown;
  to?: unknown;
}

export function formatActivityMetadataValue(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatActivityMetadataValue(entry))
      .filter(Boolean)
      .join('; ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => {
        const formatted = formatActivityMetadataValue(entryValue);
        if (!formatted) return '';
        return `${formatMetadataLabel(key)}: ${formatted}`;
      })
      .filter(Boolean)
      .join(', ');
  }
  return String(value);
}

export function getActivityMetadataAction(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const action = (metadata as Record<string, unknown>)['action'];
  return typeof action === 'string' && action.trim() ? action : null;
}

export function extractActivityChangeRows(
  metadata: unknown,
  labels: Record<string, string> = {},
): Array<{ field: string; from: string; to: string }> | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const changes = (metadata as Record<string, unknown>)['changes'];
  if (!Array.isArray(changes)) return null;

  const rows = changes
    .map((change) => {
      if (!change || typeof change !== 'object') return null;

      const field = (change as ActivityMetadataChangeRow).field;
      if (typeof field !== 'string' || !field.trim()) return null;

      return {
        field: labels[field] ?? formatMetadataLabel(field),
        from: formatActivityMetadataValue((change as ActivityMetadataChangeRow).from) || 'Empty',
        to: formatActivityMetadataValue((change as ActivityMetadataChangeRow).to) || 'Empty',
      };
    })
    .filter((row): row is { field: string; from: string; to: string } => !!row);

  return rows.length > 0 ? rows : null;
}