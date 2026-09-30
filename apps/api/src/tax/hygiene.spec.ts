import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Rules 1 and 9 in CLAUDE.md, enforced on the source: no legal parameter and no float arithmetic on money in the tax module. */
const sources = readdirSync(__dirname)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('spec.ts'))
  .map((f) => ({ f, text: readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') }));

describe('tax module source', () => {
  it('has something to check', () => {
    expect(sources.map((s) => s.f)).toEqual(expect.arrayContaining(['pipeline.ts', 'money.ts', 'rules.ts']));
  });

  it('contains no rate or threshold: no 120 000 / 500 000 MAD figure, no percentage literal', () => {
    for (const { f, text } of sources) {
      expect({ f, hit: /\b(120[_ ]?000|500[_ ]?000|12[_ ]?000[_ ]?000|50[_ ]?000[_ ]?000)\b/.test(text) }).toEqual({ f, hit: false });
      expect({ f, hit: /\b(0\.(10|15|20)|1[05] ?%)\b/.test(text) }).toEqual({ f, hit: false });
    }
  });

  it('does no float arithmetic on money', () => {
    for (const { f, text } of sources) {
      expect({ f, hit: /parseFloat|Math\.(round|floor|ceil|trunc)\(.*\*|\* ?0\.\d|\/ ?100\b(?!0)/.test(text.replace(/Math\.floor\(abs \/ 100\)/, '')) }).toEqual({ f, hit: false });
      if (f !== 'money.ts') expect({ f, hit: /toFixed|parseFloat/.test(text) }).toEqual({ f, hit: false });
    }
  });
});
