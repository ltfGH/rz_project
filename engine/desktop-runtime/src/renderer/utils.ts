export function unwrap<T>(result: unknown): T {
  if (!result || typeof result !== 'object' || !('ok' in result)) throw new Error('Invalid API response');
  const envelope = result as { ok: boolean; data?: T; error?: { message?: string } };
  if (!envelope.ok) throw new Error(envelope.error?.message ?? 'Operation failed');
  return envelope.data as T;
}
