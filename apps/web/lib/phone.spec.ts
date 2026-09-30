import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['+212 6 12-34.56.78', '+212612345678'],
    ['00212612345678', '+212612345678'],
    ['+44 7911 123456', '+447911123456'],
    ['0612345678', null],
    ['+33 (0)1 23 45 67 89', null],
    ['+21', null],
    ['abc', null],
    ['', null],
  ])('%s -> %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));
});
