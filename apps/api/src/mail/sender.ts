/** Splits `Name <address@host>` (or a bare address) as configured in MAIL_FROM. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+)>\s*$/.exec(from);
  if (match) return { ...(match[1] ? { name: match[1] } : {}), email: match[2] };
  return { email: from.trim() };
}
