import { isIP } from 'node:net';

/**
 * Rate-limit key for a client address. An IPv6 subscriber usually holds a whole /64, so keying on the full
 * address lets one client rotate through billions of keys; it is collapsed to its /64 prefix. IPv4 (also
 * IPv4-mapped IPv6) is kept whole. Anything that does not parse is returned unchanged.
 */
export function throttleKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const bare = ip.split('%')[0]; // zone id (fe80::1%eth0)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped) return mapped[1];
  if (isIP(bare) !== 6) return ip;
  const groups = expandIpv6(bare);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : ip;
}

/** The eight 16-bit groups of a valid IPv6 address, as lower-case hex without leading zeros. */
function expandIpv6(ip: string): string[] | null {
  let addr = ip.toLowerCase();
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    addr = addr.slice(0, v4.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  return groups.length === 8 ? groups.map((g) => parseInt(g, 16).toString(16)) : null;
}
