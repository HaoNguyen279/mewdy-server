/** Returns an address only when its verification claim came from the server-verified provider token. */
export function getTrustedProviderEmail(email: unknown, emailVerified: unknown): string | null {
  if (emailVerified !== true || typeof email !== "string" || !email.trim()) return null;
  return email.trim().toLowerCase();
}
