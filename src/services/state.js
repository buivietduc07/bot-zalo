const warnings = new Map();
const last = new Map();
export function warn(groupId, userId) {
  const key = `${groupId}:${userId}`;
  const count = (warnings.get(key) || 0) + 1;
  warnings.set(key, count);
  return count;
}
export function canRespond(key, cooldown) {
  const now = Date.now();
  if (now - (last.get(key) || 0) < cooldown) return false;
  last.set(key, now);
  if (last.size > 5000) last.clear();
  return true;
}
