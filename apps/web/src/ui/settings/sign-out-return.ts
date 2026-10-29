/** Whether the backup page was opened from the sign-out confirmation (`?then=sign-out`), so it can offer the way back (spec 011, FR-008). */
export function returnsToSignOut(search: string): boolean {
  try {
    const values = new URLSearchParams(search).getAll('then');
    return values.length === 1 && values[0] === 'sign-out';
  } catch {
    return false;
  }
}
