import type { BookingClassification, BookingSource } from '@prisma/client';

/**
 * Booking vs owner block from the event summary, per platform. Anything not recognised is UNCERTAIN
 * and does not count until a person confirms it (Phase 2 plan, "Owner blocks").
 *
 * - Airbnb exports "Reserved" for stays and "Airbnb (Not available)" for blocked dates.
 * - Booking.com exports "CLOSED - Not available" for both reservations and manual blocks, so those
 *   events cannot be told apart from the feed alone: they are UNCERTAIN, with a review list.
 * - Direct calendars (Google, Outlook…): a block keyword means OWNER_BLOCK, otherwise BOOKING.
 * - Other/unknown feeds: block keywords are recognised, the rest is UNCERTAIN.
 */
export interface Classification {
  classification: BookingClassification;
  /** Short, stable reason shown in the review list; never the raw summary of a direct calendar. */
  reason: string;
}

// Matched on a lower-cased copy with accents removed, so "Bloqué" and "Réservé" work with ASCII patterns.
const BLOCK_WORDS = /\b(not available|unavailable|blocked?|bloquee?s?|indisponible|owner|proprietaire|maintenance|closed|fermee?)\b/;
const BOOKING_WORDS = /\b(reserved|reservations?|reservee?s?|booked|booking|confirmed|confirmee?s?|guest|sejour)\b/;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function classify(platform: BookingSource, summary: string): Classification {
  const s = fold(summary);
  switch (platform) {
    case 'AIRBNB':
      if (s === 'reserved') return { classification: 'BOOKING', reason: 'airbnb.reserved' };
      if (s.includes('not available')) return { classification: 'OWNER_BLOCK', reason: 'airbnb.not_available' };
      return { classification: 'UNCERTAIN', reason: 'airbnb.unknown_summary' };
    case 'BOOKING':
      if (/^closed\s*-\s*not available$/.test(s)) return { classification: 'UNCERTAIN', reason: 'booking.closed_not_available' };
      if (BOOKING_WORDS.test(s)) return { classification: 'BOOKING', reason: 'booking.reservation' };
      if (BLOCK_WORDS.test(s)) return { classification: 'OWNER_BLOCK', reason: 'booking.block' };
      return { classification: 'UNCERTAIN', reason: 'booking.unknown_summary' };
    case 'DIRECT':
      if (BLOCK_WORDS.test(s)) return { classification: 'OWNER_BLOCK', reason: 'direct.block_keyword' };
      return { classification: 'BOOKING', reason: 'direct.default_booking' };
    default:
      if (BLOCK_WORDS.test(s)) return { classification: 'OWNER_BLOCK', reason: 'other.block_keyword' };
      if (BOOKING_WORDS.test(s)) return { classification: 'BOOKING', reason: 'other.booking_keyword' };
      return { classification: 'UNCERTAIN', reason: 'other.unknown_summary' };
  }
}

/** Summaries from direct or unknown calendars may contain guest names: only platform summaries are stored. */
export function storableSummary(platform: BookingSource, summary: string): string | null {
  return platform === 'AIRBNB' || platform === 'BOOKING' ? summary.slice(0, 120) : null;
}
