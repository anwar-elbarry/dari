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

function v6Blocked(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Blocked(mapped[1]);
  if (lower === '::' || lower === '::1') return true;
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  if (/^f[cd]/.test(lower)) return true; // unique local fc00::/7
  if (/^ff/.test(lower)) return true; // multicast
  if (lower.startsWith('2001:db8')) return true; // documentation
  if (lower.startsWith('64:ff9b')) return true; // NAT64: could map to private v4
  if (lower.startsWith('2002:')) return true; // 6to4: embeds a v4 address
  return false;
}

export const publicOnly: AddressPolicy = (ip) => {
  const kind = isIP(ip);
  if (kind === 4) return !v4Blocked(ip);
  if (kind === 6) return !v6Blocked(ip);
  return false;
};
