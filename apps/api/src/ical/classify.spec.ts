import { classify, storableSummary } from './classify';

describe('classify', () => {
  it('Airbnb', () => {
    expect(classify('AIRBNB', 'Reserved').classification).toBe('BOOKING');
    expect(classify('AIRBNB', 'Airbnb (Not available)').classification).toBe('OWNER_BLOCK');
    expect(classify('AIRBNB', 'Something new').classification).toBe('UNCERTAIN');
  });

  it('Booking.com cannot tell blocks from stays: uncertain until confirmed', () => {
    expect(classify('BOOKING', 'CLOSED - Not available')).toEqual({ classification: 'UNCERTAIN', reason: 'booking.closed_not_available' });
    expect(classify('BOOKING', 'Booked').classification).toBe('BOOKING');
    expect(classify('BOOKING', '').classification).toBe('UNCERTAIN');
  });

  it('direct calendars: block keywords in French or English, otherwise a booking', () => {
    for (const s of ['Bloqué propriétaire', 'Blocked', 'Not available', 'Indisponible', 'Maintenance', 'Fermé']) {
      expect(classify('DIRECT', s).classification).toBe('OWNER_BLOCK');
    }
    expect(classify('DIRECT', 'Famille Dupont - 4 pers').classification).toBe('BOOKING');
  });

  it('other feeds only trust explicit keywords', () => {
    expect(classify('OTHER', 'Réservation Smith').classification).toBe('BOOKING');
    expect(classify('OTHER', 'Owner stay').classification).toBe('OWNER_BLOCK');
    expect(classify('OTHER', 'Mystery').classification).toBe('UNCERTAIN');
  });

  it('never stores summaries from direct or unknown calendars', () => {
    expect(storableSummary('AIRBNB', 'Reserved')).toBe('Reserved');
    expect(storableSummary('DIRECT', 'Famille Dupont')).toBeNull();
    expect(storableSummary('OTHER', 'x')).toBeNull();
  });
});
