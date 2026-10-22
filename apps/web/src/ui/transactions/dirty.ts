// Whether the add form holds anything the person has not saved (FR-011): closing it asks only if it does.
const normal = (value: unknown): unknown => (typeof value === 'string' ? value.trim() : value);

export function isDirty(initial: Readonly<Record<string, unknown>>, current: Readonly<Record<string, unknown>>): boolean {
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)]);
  for (const key of keys) {
    if (JSON.stringify(normal(initial[key])) !== JSON.stringify(normal(current[key]))) return true;
  }
  return false;
}
