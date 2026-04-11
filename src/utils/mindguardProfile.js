/**
 * MindGuard treats a session as valid only when Firestore `users/{uid}` has a known role.
 * Empty objects or partial writes must not count as logged-in.
 */
export function isValidMindGuardProfile(data) {
  if (!data || typeof data !== 'object') return false;
  const r = data.role;
  return r === 'user' || r === 'guardian' || r === 'professional';
}
