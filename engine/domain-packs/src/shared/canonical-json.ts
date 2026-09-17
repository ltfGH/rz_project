function normalize(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Unsupported JSON value: non-finite number.');
    return value;
  }
  if (typeof value !== 'object') throw new Error(`Unsupported JSON value: ${typeof value}.`);
  const object = value as object;
  if (ancestors.has(object)) throw new Error('Cyclic JSON value.');
  ancestors.add(object);
  try {
    if (Array.isArray(value)) return value.map((item) => normalize(item, ancestors));
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error('Unsupported JSON value: non-plain object.');
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = normalize((value as Record<string, unknown>)[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(object);
  }
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(normalize(value, new Set()))}\n`;
}
