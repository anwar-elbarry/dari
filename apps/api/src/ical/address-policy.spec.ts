import { publicOnly } from './address-policy';

describe('publicOnly address policy', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '169.254.0.1', '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '192.0.2.1', '198.51.100.7', '203.0.113.9', '198.18.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:169.254.169.254',
    '2001:db8::1', '64:ff9b::a00:1', '2002:c0a8:101::1',
    // hex forms of embedded IPv4 (what new URL('https://[::ffff:127.0.0.1]/').hostname produces)
    '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', '::ffff:0:7f00:1', '::a00:1', '0:0:0:0:0:ffff:7f00:1', '0000::1',
    'fec0::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:1::1', '3fff::1', 'fe80::1%eth0', '::ffff:192.168.1.1',
  ])('refuses %s', (ip) => {
    expect(publicOnly(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '11.0.0.1', '2606:4700::1111', '2a00:1450:4007:80e::200e', '::ffff:8.8.8.8', '::ffff:808:808', '2001:4860:4860::8888', '2001:200::1'])(
    'allows %s',
    (ip) => {
      expect(publicOnly(ip)).toBe(true);
    },
  );

  it('refuses non-addresses', () => {
    expect(publicOnly('localhost')).toBe(false);
    expect(publicOnly('')).toBe(false);
    expect(publicOnly('1:2:3')).toBe(false);
    expect(publicOnly('::1::2')).toBe(false);
  });
});

describe('URL parser forms reach the policy in hex', () => {
  it.each(['https://[::ffff:127.0.0.1]/', 'https://[::ffff:169.254.169.254]/', 'https://[0:0:0:0:0:ffff:10.0.0.1]/'])('blocks %s', (u) => {
    const host = new URL(u).hostname; // WHATWG normalises to e.g. [::ffff:7f00:1]
    expect(publicOnly(host.slice(1, -1))).toBe(false);
  });
});
