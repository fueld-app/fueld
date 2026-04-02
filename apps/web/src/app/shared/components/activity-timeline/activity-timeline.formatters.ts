export function formatMetadataLabel(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
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