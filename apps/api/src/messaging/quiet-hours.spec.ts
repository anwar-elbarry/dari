import { inQuietHours, localParts, startOfLocalDay } from './quiet-hours';

const NIGHT = { startMinute: 22 * 60, endMinute: 7 * 60, timezone: 'Africa/Casablanca' };

describe('inQuietHours', () => {
  // Africa/Casablanca is UTC+1 in winter (2026-01) and UTC+0 in the summer months of 2026; check with the zone, not a fixed offset.
  it.each([
    ['2026-01-15T20:59:00Z', false], // 21:59 local
    ['2026-01-15T21:00:00Z', true], // 22:00 local
    ['2026-01-16T05:59:00Z', true], // 06:59 local
    ['2026-01-16T06:00:00Z', false], // 07:00 local
    ['2026-01-16T12:00:00Z', false],
  ])('%s -> %s', (iso, expected) => expect(inQuietHours(new Date(iso), NIGHT)).toBe(expected));

  it('follows the zone when its offset changes', () => {
    const instant = new Date('2026-07-15T22:30:00Z');
    const local = localParts(instant, 'Africa/Casablanca');
    expect(inQuietHours(instant, NIGHT)).toBe(local.minuteOfDay >= 22 * 60 || local.minuteOfDay < 7 * 60);
  });

  it('handles a same-day window and an empty one', () => {
    const noon = { startMinute: 12 * 60, endMinute: 14 * 60, timezone: 'UTC' };
    expect(inQuietHours(new Date('2026-01-15T13:00:00Z'), noon)).toBe(true);
    expect(inQuietHours(new Date('2026-01-15T14:00:00Z'), noon)).toBe(false);
    expect(inQuietHours(new Date('2026-01-15T03:00:00Z'), { startMinute: 0, endMinute: 0, timezone: 'UTC' })).toBe(false);
  });
});

describe('startOfLocalDay', () => {
  it('is local midnight as a UTC instant', () => {
    expect(startOfLocalDay(new Date('2026-01-15T23:30:00Z'), 'UTC').toISOString()).toBe('2026-01-15T00:00:00.000Z');
    const start = startOfLocalDay(new Date('2026-01-15T23:30:00Z'), 'Africa/Casablanca');
    expect(localParts(start, 'Africa/Casablanca')).toMatchObject({ day: 16, minuteOfDay: 0 });
  });
});
