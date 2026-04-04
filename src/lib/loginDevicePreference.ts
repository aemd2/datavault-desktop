/**
 * Remembers which email addresses have completed sign-in on this browser.
 *
 * Used to choose login UX:
 * - First time (email not seen here): email → OTP/code step (and magic-link help).
 * - Returning (email seen before): email only → we tell them to use the link in the email.
 *
 * Magic-link sign-ins still call `rememberSignInEmail` via `onAuthStateChange` in the app,
 * so users who never typed a code still become "returning" next visit.
 */
const STORAGE_KEY = "datavault.signInEmails";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Emails that have successfully signed in on this device (at least once). */
export function readKnownSignInEmails(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((e): e is string => typeof e === "string").map((e) => normalizeEmail(e)));
  } catch {
    return new Set();
  }
}

/** True if this email should use the simpler "link only" returning flow. */
export function isReturningSignInEmail(email: string): boolean {
  return readKnownSignInEmails().has(normalizeEmail(email));
}

/** Call after any successful session for this email (OTP verify, magic link, etc.). */
export function rememberSignInEmail(email: string): void {
  const key = normalizeEmail(email);
  if (!key) return;
  const next = readKnownSignInEmails();
  next.add(key);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
}
