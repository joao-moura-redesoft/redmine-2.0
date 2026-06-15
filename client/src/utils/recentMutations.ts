const mutated = new Map<number, number>(); // issueId → timestamp ms

export function recordMutation(issueId: number) {
  mutated.set(issueId, Date.now());
}

export function wasRecentlyMutated(issueId: number, windowMs = 120_000): boolean {
  const ts = mutated.get(issueId);
  if (ts === undefined) return false;
  if (Date.now() - ts > windowMs) {
    mutated.delete(issueId);
    return false;
  }
  return true;
}
