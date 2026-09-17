export type DeadlineStatus = 'pending' | 'met' | 'overdue';

function timestamp(value: Date | string, name: string): number {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) throw new RangeError(`${name} must be a valid date.`);
  return result;
}

export function calculateDeadline(createdAt: Date, minutes: number): string {
  const created = timestamp(createdAt, 'createdAt');
  if (!Number.isSafeInteger(minutes) || minutes <= 0) {
    throw new RangeError('minutes must be a positive integer.');
  }
  const deadline = new Date(created + minutes * 60_000);
  if (!Number.isFinite(deadline.getTime())) throw new RangeError('deadline must be a valid date.');
  return deadline.toISOString();
}

export function evaluateDeadline(
  actualAt: string | null,
  dueAt: string,
  now: Date
): DeadlineStatus {
  const due = timestamp(dueAt, 'dueAt');
  if (actualAt !== null) return timestamp(actualAt, 'actualAt') <= due ? 'met' : 'overdue';
  return timestamp(now, 'now') <= due ? 'pending' : 'overdue';
}
