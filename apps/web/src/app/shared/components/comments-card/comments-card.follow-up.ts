const MS_PER_DAY = 86_400_000;

function toLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);

  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month
    || parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayDateString(now = new Date()): string {
  return formatLocalDate(toLocalMidnight(now));
}

export function normalizeFollowUpDays(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;

    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function followUpDateFromDays(days: number, now = new Date()): string {
  const target = toLocalMidnight(now);
  target.setDate(target.getDate() + Math.trunc(days));
  return formatLocalDate(target);
}

export function followUpDaysFromDate(dateStr: string, now = new Date()): number {
  const target = parseDateOnly(dateStr);
  if (!target) return 0;

  const today = toLocalMidnight(now);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}