export interface StructuredActivityChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface StructuredActivityMetadata {
  action: string;
  changes: StructuredActivityChange[];
}

export interface StructuredActivityFieldDescriptor<T> {
  field: string;
  value: (entity: T) => unknown;
  displayValue?: (entity: T) => unknown;
}

function normalizeActivityValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalizeActivityValue(entry));
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = normalizeActivityValue((value as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }
  return value;
}

function areStructuredActivityValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeActivityValue(left)) === JSON.stringify(normalizeActivityValue(right));
}

export function buildStructuredActivityDiff<T>(params: {
  action: string;
  before: T;
  after: T;
  fields: StructuredActivityFieldDescriptor<T>[];
}): StructuredActivityMetadata | null {
  const changes = params.fields
    .filter((field) => !areStructuredActivityValuesEqual(field.value(params.before), field.value(params.after)))
    .map<StructuredActivityChange>((field) => ({
      field: field.field,
      from: normalizeActivityValue(field.displayValue ? field.displayValue(params.before) : field.value(params.before)),
      to: normalizeActivityValue(field.displayValue ? field.displayValue(params.after) : field.value(params.after)),
    }));

  return changes.length > 0
    ? {
        action: params.action,
        changes,
      }
    : null;
}