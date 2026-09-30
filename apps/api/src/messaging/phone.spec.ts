import { maskPhone, nameVariable, normalizePhone, templateVariable } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['+212 6 12-34.56.78', '+212612345678'],
    ['00212612345678', '+212612345678'],
    [' +33 (0)1 23 45 67 89 ', null], // a bracketed trunk "0" would be joined into a wrong number: refused
    ['+447911123456', '+447911123456'],
  ])('%s -> %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each([['0612345678'], ['+0212612345678'], ['+21'], ['+2126123456789012345'], ['abc'], [''], [null], [42], ['+212612345678'.padEnd(50, '1')]])('refuses %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('maskPhone', () => {
  it('keeps the prefix and the last two digits', () => {
    expect(maskPhone('+212612345678')).toBe('+212•••••••78');
    expect(maskPhone('+212612345678')).not.toContain('6123456');
  });
});

describe('nameVariable', () => {
  it('keeps an ordinary name and strips what makes a link, a domain or an address', () => {
    expect(nameVariable('Riad Yasmine')).toBe('Riad Yasmine');
    expect(nameVariable('Dar Al-Andalus, Médina')).toBe('Dar Al-Andalus, Médina');
    for (const hostile of ['Your account is blocked http://evil.example/login', 'pay at evil.example', 'write to a@evil.example', 'www.evil.example now']) {
      const out = nameVariable(hostile);
      expect(out).not.toMatch(/[:/@.]/);
    }
    expect(nameVariable('x'.repeat(200))).toHaveLength(60);
    expect(nameVariable('...')).toBe('-');
  });
});

describe('templateVariable', () => {
  it('flattens whitespace, trims, caps the length and never returns an empty value', () => {
    expect(templateVariable(' Riad \n\t  Atlas ')).toBe('Riad Atlas');
    expect(templateVariable('x'.repeat(300))).toHaveLength(200);
    expect(templateVariable('  \n ')).toBe('-');
  });
});
