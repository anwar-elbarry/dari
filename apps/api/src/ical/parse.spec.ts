import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, parseIcs } from './parse';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseIcs', () => {
  it('reads Airbnb date-only events', () => {
    const { events, skipped } = parseIcs(fixture('airbnb.ics'));
    expect(skipped).toBe(0);
    expect(events).toEqual([
      { uid: '1a2b3c4d5e6f-abc123@airbnb.com', start: '2026-03-05', end: '2026-03-09', summary: 'Reserved', cancelled: false },
      { uid: '2b3c4d5e6f7a-def456@airbnb.com', start: '2026-03-10', end: '2026-03-12', summary: 'Airbnb (Not available)', cancelled: false },
      { uid: '3c4d5e6f7a8b-ghi789@airbnb.com', start: '2026-12-30', end: '2027-01-03', summary: 'Reserved', cancelled: false },
    ]);
  });

  it('turns a zero-length Booking.com event into one night', () => {
    const { events } = parseIcs(fixture('booking.ics'));
    expect(events[1]).toMatchObject({ start: '2026-04-01', end: '2026-04-02' });
  });

  it('converts date-times to Casablanca dates, keeps cancelled flags, skips recurring and uid-less events', () => {
    const { events, skipped } = parseIcs(fixture('direct.ics'));
    expect(skipped).toBe(2);
    expect(events.map((e) => [e.uid, e.start, e.end, e.cancelled])).toEqual([
      ['direct-1@google.com', '2026-03-15', '2026-03-18', false],
      ['direct-2@google.com', '2026-03-20', '2026-03-25', false],
      ['direct-3@google.com', '2026-04-01', '2026-04-03', true],
    ]);
  });

  it('places a late-evening UTC check-in on the next Casablanca day in summer (UTC+1)', () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20260715T233000Z\nDTEND:20260717T233000Z\nSUMMARY:Reserved\nEND:VEVENT\nEND:VCALENDAR';
    expect(parseIcs(ics).events[0]).toMatchObject({ start: '2026-07-16', end: '2026-07-18' });
  });

  it('tolerates garbage input', () => {
    expect(parseIcs('not a calendar').events).toEqual([]);
    expect(parseIcs('').events).toEqual([]);
  });

  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
