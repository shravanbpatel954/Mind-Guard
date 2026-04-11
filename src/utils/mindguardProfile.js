/**
 * Canonical role string from Firestore (trim + lowercase) or null if missing/invalid.
 */
export function normalizeMindGuardRole(data) {
  if (!data || typeof data !== 'object') return null;
  const raw = data.role;
  const r = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (r === 'user' || r === 'guardian' || r === 'professional') return r;
  return null;
}

/**
 * MindGuard treats a session as valid only when Firestore `users/{uid}` has a known role.
 * Empty objects or partial writes must not count as logged-in.
 */
export function isValidMindGuardProfile(data) {
  return normalizeMindGuardRole(data) != null;
}
