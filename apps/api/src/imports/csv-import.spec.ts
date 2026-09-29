import { csvCell, detectDelimiter, parseAmount, parseDate, parseImport, parsePlatform, suggestMapping, TEMPLATE_CSV } from './csv-import';

describe('csv import parsing', () => {
  it('parses the Dari template', () => {
    const r = parseImport(TEMPLATE_CSV);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, checkIn: '2026-01-10', checkOut: '2026-01-14', platform: 'AIRBNB', confirmationCode: 'HMABC123', partySize: 2, amounts: { nightly_revenue: '3200.00', cleaning_fee: '250.00', addon_revenue: '0.00', discounts: '0.00', refunds: '0.00', platform_commission: '480.00', taxe_sejour_amount: '0.00' } },
    ]);
  });

  it('maps French headers, semicolons, DD/MM/YYYY dates and comma decimals', () => {
    const text = '\uFEFFArrivée;Départ;Plateforme;Référence;Voyageurs;Revenu;Ménage;Taxe de séjour\n15/03/2026;18/03/2026;Booking.com;ABC-1;3;"1 250,50";150;"45,00"\n';
    const r = parseImport(text);
    expect(r.delimiter).toBe(';');
    expect(r.suggestedMapping).toEqual({ Arrivée: 'check_in', Départ: 'check_out', Plateforme: 'platform', Référence: 'confirmation_code', Voyageurs: 'party_size', Revenu: 'nightly_revenue', Ménage: 'cleaning_fee', 'Taxe de séjour': 'taxe_sejour_amount' });
    expect(r.rows[0]).toMatchObject({ checkIn: '2026-03-15', checkOut: '2026-03-18', platform: 'BOOKING', confirmationCode: 'ABC-1', partySize: 3, amounts: { nightly_revenue: '1250.50', cleaning_fee: '150.00', taxe_sejour_amount: '45.00' } });
  });

  it('reports row errors with line numbers and keeps good rows', () => {
    const text = ['check_in,check_out,platform,nightly_revenue,party_size', '2026-01-10,2026-01-14,AIRBNB,100,2', '2026-01-10,2026-01-10,AIRBNB,100,2', '31/02/2026,2026-01-14,AIRBNB,100,2', '2026-01-10,2026-01-14,Expedia,abc,0', ',2026-01-14,,,', '2026-01-10,2026-01-14,AIRBNB,-5,'].join('\n');
    const r = parseImport(text);
    expect(r.rows.map((x) => x.line)).toEqual([2]);
    expect(r.errors).toEqual([
      { line: 3, field: 'check_out', code: 'checkout_not_after_checkin' },
      { line: 4, field: 'check_in', code: 'invalid_date' },
      { line: 5, field: 'platform', code: 'invalid_platform' },
      { line: 5, field: 'party_size', code: 'invalid_party_size' },
      { line: 5, field: 'nightly_revenue', code: 'invalid_amount' },
      { line: 6, field: 'check_in', code: 'required' },
      { line: 7, field: 'nightly_revenue', code: 'invalid_amount' },
    ]);
    expect(r.totalRows).toBe(6);
  });

  it('flags duplicates inside the file by code or by dates and platform', () => {
    const text = 'check_in,check_out,platform,confirmation_code\n2026-01-10,2026-01-14,AIRBNB,X\n2026-01-20,2026-01-22,AIRBNB,X\n2026-02-01,2026-02-03,,\n2026-02-01,2026-02-03,direct,\n';
    const r = parseImport(text);
    expect(r.errors).toEqual([
      { line: 3, field: 'confirmation_code', code: 'duplicate_in_file' },
      { line: 5, field: null, code: 'duplicate_in_file' },
    ]);
  });

  it('honours an explicit mapping over the suggestion', () => {
    const text = 'a,b\n2026-05-01,2026-05-03\n';
    expect(parseImport(text).errors[0].code).toBe('required');
    expect(parseImport(text, { a: 'check_in', b: 'check_out' }).rows).toHaveLength(1);
  });

  it('helpers', () => {
    expect(parseDate('2026-2-3')).toBe('2026-02-03');
    expect(parseDate('03.02.2026')).toBe('2026-02-03');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('1999-01-01')).toBeNull();
    expect(parseAmount('1 234,5')).toBe('1234.50');
    expect(parseAmount('1,234.50')).toBe('1234.50');
    expect(parseAmount('12 MAD')).toBe('12.00');
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeUndefined();
    expect(parseAmount('-3')).toBeUndefined();
    expect(parsePlatform('')).toBe('DIRECT');
    expect(parsePlatform('AirBnB')).toBe('AIRBNB');
    expect(parsePlatform('Booking . com')).toBe('BOOKING');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(suggestMapping(['Check-in', 'Check-out', 'Total'])).toEqual({ 'Check-in': 'check_in', 'Check-out': 'check_out', Total: 'nightly_revenue' });
  });

  it('csvCell neutralises formulas and quotes separators', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
  });

  it('survives malformed input', () => {
    expect(parseImport('').rows).toEqual([]);
    expect(parseImport('"unterminated\n1,2').rows).toEqual([]);
  });
});
