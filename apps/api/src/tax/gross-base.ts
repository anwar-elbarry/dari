/**
 * Gross taxable base (Business Spec 3.B / Tech Spec 6.3, step 1):
 *   nightly + invoiced cleaning + additional services - discounts - refunds
 * Amounts are integer centimes to avoid floating-point drift.
 * Rates and thresholds are NOT defined here: they come from TaxRule (validated by the fiduciaire).
 */
export interface BookingAmounts {
  nightly: number;
  cleaning: number;
  addons: number;
  discounts: number;
  refunds: number;
}

export function grossBase(a: BookingAmounts): number {
  return a.nightly + a.cleaning + a.addons - a.discounts - a.refunds;
}
