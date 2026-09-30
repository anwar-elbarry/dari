import { throttleKey } from './throttle-key';

describe('throttleKey', () => {
  it('keeps IPv4 whole', () => {
    expect(throttleKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('treats an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(throttleKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('collapses IPv6 addresses of one /64 to one key', () => {
    const a = throttleKey('2001:db8:abcd:12::1');
    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(throttleKey('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff')).toBe(a);
    expect(throttleKey('2001:db8:abcd:12:1:2:3:4')).toBe(a);
  });

  it('separates different /64 prefixes', () => {
    expect(throttleKey('2001:db8:abcd:12::1')).not.toBe(throttleKey('2001:db8:abcd:13::1'));
  });

  it('handles compression at either end and embedded IPv4', () => {
    expect(throttleKey('::1')).toBe('0:0:0:0::/64');
    expect(throttleKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(throttleKey('64:ff9b::203.0.113.7')).toBe('64:ff9b:0:0::/64');
  });

  it('drops a zone id and survives missing or malformed input', () => {
    expect(throttleKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(throttleKey(undefined)).toBe('unknown');
    expect(throttleKey('not-an-ip')).toBe('not-an-ip');
  });
});
