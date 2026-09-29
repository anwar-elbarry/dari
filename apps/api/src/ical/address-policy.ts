import { isIP } from 'node:net';

/**
 * Which IP addresses an outbound fetch may connect to. Default: public unicast only.
 * Refuses loopback, private (RFC 1918), link-local, CGNAT, cloud metadata (169.254.169.254),
 * multicast, unspecified, documentation ranges, and their IPv6 and IPv4-mapped forms.
 */
export type AddressPolicy = (ip: string) => boolean;

function v4Blocked(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || // unspecified / "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24 and 192.0.2.0/24 (documentation)
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51) || // 198.51.100.0/24 documentation
    (a === 203 && b === 0) || // 203.0.113.0/24 documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expands an IPv6 address (including "::" and a trailing dotted IPv4) to eight 16-bit groups. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0];
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[2].split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    text = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4FromGroups = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * IPv6 policy on the address bytes, not on its text form:
 * - an address that embeds an IPv4 one (::/96, IPv4-mapped ::ffff:0:0/96, IPv4-translated ::ffff:0:0:0/96)
 *   is judged by that IPv4 address, whichever way it is written (dotted or hex);
 * - everything else is allowed only inside global unicast 2000::/3, minus the special ranges inside it:
 *   2001::/23 (Teredo, benchmarking, ORCHID…), 2001:db8::/32 (documentation), 2002::/16 (6to4), 3fff::/20 (documentation).
 * Loopback, link-local, unique-local, site-local (fec0::/10), multicast and NAT64 are outside 2000::/3.
 */
function v6Blocked(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return true;
  const zeros5 = g.slice(0, 5).every((n) => n === 0);
  if (zeros5 && (g[5] === 0 || g[5] === 0xffff)) return v4Blocked(v4FromGroups(g[6], g[7]));
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff && g[5] === 0) return v4Blocked(v4FromGroups(g[6], g[7]));
  if ((g[0] & 0xe000) !== 0x2000) return true;
  if (g[0] === 0x2001 && g[1] <= 0x01ff) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  if (g[0] === 0x2002) return true;
  if (g[0] === 0x3fff && g[1] <= 0x0fff) return true;
  return false;
}

export const publicOnly: AddressPolicy = (ip) => {
  const kind = isIP(ip);
  if (kind === 4) return !v4Blocked(ip);
  if (kind === 6) return !v6Blocked(ip);
  return false;
};
