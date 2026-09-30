export type Role = 'OWNER_MANAGER' | 'STAFF' | 'ACCOUNTANT';

export interface Me {
  user: { id: string; name: string; email: string; role: Role };
  account: { id: string; companyName: string; subscriptionTier: string };
  capabilities: string[];
}

export type LicenseStatus = 'LICENSED' | 'UNLICENSED' | 'PENDING';
export type LicenseType = 'FURNISHED_APARTMENT' | 'RIAD' | 'MAISON_DHOTE' | 'AUBERGE';
export type TaxRegime = 'PROPERTY_INCOME' | 'PROFESSIONAL' | 'COMPANY';
export type TaxeSejourMode = 'INCLUDED' | 'COLLECTED';
export type Residency = 'RESIDENT' | 'NON_RESIDENT' | 'MRE';
export type BankAccountType = 'STANDARD' | 'CONVERTIBLE_DIRHAM' | 'FOREIGN_CURRENCY';

export interface PropertyReduced {
  id: string;
  name: string;
  address: string;
  commune: string;
  licenseStatus: LicenseStatus;
  licenseType: LicenseType;
}

export interface PropertyFull extends PropertyReduced {
  taxRegime: TaxRegime;
  taxeSejourMode: TaxeSejourMode;
  icalUrl: string | null;
  createdAt: string;
  owner: { id: string; name: string; residency: Residency };
}

export interface Owner {
  id: string;
  name: string;
  taxId: string | null;
  residency: Residency;
  bankAccountType: BankAccountType;
  _count?: { properties: number };
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export type Level = 'green' | 'amber' | 'red';
export type Platform = 'AIRBNB' | 'BOOKING' | 'DIRECT' | 'OTHER';
export type Classification = 'BOOKING' | 'OWNER_BLOCK' | 'UNCERTAIN';

export interface DayCounter {
  propertyId: string;
  year: number;
  applies: boolean;
  nights: number;
  level: Level;
  thresholds: { amber: number; red: number; cap: number };
  rulesValidated: boolean;
  projectedBreachDate: string | null;
  pendingReview: number;
  uncertainNights: number;
  ownerBlockNights: number;
}

export interface Stay {
  id: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  source: Platform;
  classification: Classification;
  classifiedBy: 'AUTO' | 'MANUAL';
  status: 'CONFIRMED' | 'CANCELLED';
  summary: string | null;
  nightlyRevenue?: string | null;
}

export interface Feed {
  id: string;
  propertyId: string;
  platform: Platform;
  url: string;
  lastSyncedAt: string | null;
  lastStatus: 'NEVER' | 'OK' | 'ERROR';
  lastError: string | null;
  eventCount: number;
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  created: number;
  updated: number;
  cancelled: number;
  skipped: number;
}

export interface AlertItem {
  id: string;
  type: string;
  severity: 'INFO' | 'AMBER' | 'RED';
  propertyId: string | null;
  year: number | null;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DashboardProperty {
  id: string;
  name: string;
  commune: string;
  licenseStatus: LicenseStatus;
  licenseType: LicenseType;
  counter: { applies: boolean; nights: number; level: Level; projectedBreachDate: string | null; pendingReview: number };
  feedProblems?: number;
}

export interface Dashboard {
  year: number;
  thresholds: { amber: number; red: number; cap: number } | null;
  rulesValidated: boolean;
  totals: { properties: number; atRisk: number; pendingReview: number };
  properties: DashboardProperty[];
  alerts: AlertItem[];
}

export interface ImportError {
  line: number;
  field: string | null;
  code: string;
}

export interface ImportPreview {
  headers: string[];
  delimiter: string;
  mapping: Record<string, string>;
  totalRows: number;
  validRows: number;
  alreadyImported: number;
  errors: ImportError[];
  errorCount: number;
  preview: { line: number; checkIn: string; checkOut: string; platform: Platform; confirmationCode: string | null; partySize: number | null }[];
}

export interface ImportResult {
  batchId: string;
  imported: number;
  skippedExisting: number;
  skippedWithErrors: number;
}

export type CheckinState = 'NONE' | 'LINK_SENT' | 'PARTIAL' | 'COMPLETE';
export type LinkStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'COMPLETED';
export type GuestStatus = 'SUBMITTED' | 'VERIFIED';
export type DocType = 'PASSPORT' | 'CIN';

export interface ArrivalGuest {
  id: string;
  guestIndex: number | null;
  status: GuestStatus;
  submittedAt: string | null;
  hasFiche: boolean;
  /** Only for Owner/Manager; Staff see status only. */
  fullName?: string | null;
}

export interface ArrivalLink {
  id: string;
  status: LinkStatus;
  expiresAt: string;
  guestsSubmitted: number;
  maxGuests: number;
}

export interface Arrival {
  bookingId: string;
  checkIn: string;
  checkOut: string;
  partySize: number | null;
  source: Platform;
  checkinStatus: CheckinState;
  guests: ArrivalGuest[];
  link: ArrivalLink | null;
}

/** Returned once, when a link is created or resent. The token is never available again. */
export interface CreatedLink {
  id: string;
  bookingId: string;
  status: LinkStatus;
  createdAt: string;
  expiresAt: string;
  maxGuests: number;
  guestsSubmitted: number;
  token: string;
  url: string;
}

export interface GuestFields {
  docType: DocType | null;
  fullName: string | null;
  nationality: string | null;
  docNumber: string | null;
  dob: string | null;
  docExpiryDate: string | null;
  declaredMoroccanNationality: boolean;
  entryStampNumber: string | null;
  cityOfOrigin: string | null;
  nextDestination: string | null;
  profession: string | null;
}

export interface GuestDetail {
  id: string;
  bookingId: string;
  propertyId: string;
  guestIndex: number | null;
  status: GuestStatus;
  submittedAt: string | null;
  hasDocument: boolean;
  hasFiche: boolean;
  /** Owner/Manager only. */
  fields?: GuestFields;
  consent?: { at: string | null; textId: string | null };
  ocr?: { confidence: number | null; flagged: string[]; edited: string[] };
}

/* ---- Police register and Secure Share (Phase 4) ---- */
export type RegisterStatus = 'none' | 'generated' | 'outdated';
export type ProblemKind = 'NO_CHECKIN' | 'PARTY_INCOMPLETE' | 'DRAFT' | 'MISSING_FIELD' | 'UNVERIFIED';
export type MandatoryField = 'docNumber' | 'entryStampNumber' | 'cityOfOrigin' | 'nextDestination' | 'profession';

export interface RegisterSummary {
  stays: number;
  guests: number;
  problems: number;
  byKind: Record<ProblemKind, number>;
}

/** Staff get `month` and `status` only; Owner/Manager get the rest. */
export interface RegisterMonth extends Partial<RegisterSummary> {
  month: string;
  status: RegisterStatus;
  generatedAt?: string | null;
}

export interface RegisterProblem {
  kind: ProblemKind;
  bookingId: string;
  guestId?: string;
  fields?: MandatoryField[];
}

export interface ValidationReport {
  month: string;
  summary: RegisterSummary;
  problems: RegisterProblem[];
  stays: Record<string, { checkIn: string; checkOut: string }>;
}

export interface GeneratedRegister {
  month: string;
  templateVersion: string;
  generatedAt: string;
  summary: RegisterSummary;
  problems: RegisterProblem[];
  /** Links to the previous version, revoked by this generation. */
  revokedShares: number;
}

export type ShareStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export type ShareResourceType = 'FICHE_DE_POLICE' | 'POLICE_REGISTER';
export type ShareTarget = { type: 'FICHE_DE_POLICE'; guestId: string } | { type: 'POLICE_REGISTER'; propertyId: string; month: string };

export interface ShareLifetime {
  minHours: number;
  maxHours: number;
  validated: boolean;
}

export interface ShareRow {
  id: string;
  resourceType: ShareResourceType;
  resource: { guestId?: string | null; propertyId?: string | null; month?: string | null };
  recipientLabel: string;
  status: ShareStatus;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastAccessAt: string | null;
}

/** Returned once, when a link is created. The token is never available again. */
export interface CreatedShare extends ShareRow {
  token: string;
  url: string;
}

export interface ShareAccessRow {
  at: string;
  userAgent: string;
}

/* ---- Monthly tax estimate (Phase 5). Money is always integer centimes; see lib/tax.ts for display. ---- */
export type TaxReportStatus = 'generated' | 'outdated';
export type TaxMonthStatus = 'none' | TaxReportStatus;
export type TaxProblemCode = 'NO_AMOUNTS' | 'TAXE_SEJOUR_MISSING' | 'PARTY_SIZE_MISSING' | 'RULE_MISSING';
export type TaxLineKey = 'nights_revenue' | 'addon_revenue' | 'taxe_sejour_deducted' | 'gross_base' | 'platform_commission' | 'income_tax' | 'vat' | 'local_tax' | 'nonresident_statement';
export type TaxLineNote = 'not_applicable' | 'rule_missing' | 'rate_bps' | 'catch_up' | 'residency' | 'not_deducted';

/** The disclaimer wording comes from the API (RuleConfig), never from the app. */
export interface DisclaimerText {
  version: string;
  banner: string;
  text: string;
}
export type Disclaimer = Record<'fr' | 'en', DisclaimerText>;

export interface TaxRuleStatus {
  key: string;
  present: boolean;
  value?: unknown;
  validated: boolean;
  validatedBy?: string | null;
  validatedAt?: string | null;
}

export interface TaxRules {
  disclaimers: { beta: Disclaimer; standard: Disclaimer };
  rules: TaxRuleStatus[];
  localTaxRules: number;
}

export interface TaxProblem {
  code: TaxProblemCode;
  bookingId?: string;
  rule?: string;
}

export type TaxProblemCounts = Partial<Record<TaxProblemCode, number>>;

export interface TaxTotals {
  nightsRevenue: number;
  addonRevenue: number;
  grossBase: number;
  taxeSejourDeducted: number;
  vatTotal: number;
  incomeTaxTotal: number;
  localTaxTotal: number;
}

export interface TaxReportSummary {
  id: string;
  propertyId: string;
  propertyName: string;
  /** YYYY-MM */
  month: string;
  regime: TaxRegime;
  status: TaxReportStatus;
  beta: boolean;
  totals: TaxTotals;
  problemCounts: TaxProblemCounts;
  /** Only for people who may generate. */
  problems?: TaxProblem[];
  bankAccountType: BankAccountType | null;
  templateVersion: string;
  disclaimerVersion: string;
  generatedAt: string;
}

export interface TaxLine {
  key: TaxLineKey;
  /** Integer centimes; null = not computed. */
  amount: number | null;
  info?: boolean;
  note?: TaxLineNote;
  detail?: string;
}

export interface TaxReportRule {
  key: string;
  present: boolean;
  validated: boolean;
  validatedAt: string | null;
}

export interface TaxReportDetail extends TaxReportSummary {
  lines: TaxLine[];
  rules: TaxReportRule[];
}

export interface TaxMonth {
  month: string;
  status: TaxMonthStatus;
  reportId: string | null;
  generatedAt: string | null;
  beta: boolean | null;
}

export interface TaxMonths {
  property: { id: string; name: string; regime: TaxRegime; taxeSejourMode: TaxeSejourMode };
  months: TaxMonth[];
}

export interface TaxMissing {
  month: string;
  beta: boolean;
  problems: TaxProblem[];
  problemCounts: TaxProblemCounts;
  stays: Record<string, { checkIn: string; checkOut: string }>;
}

/** A stay as Owner/Manager receive it: revenue fields are Decimal strings ("1234.5") or null. */
export interface StayAmounts {
  id: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  partySize: number | null;
  nightlyRevenue: string | null;
  cleaningFee: string | null;
  addonRevenue: string | null;
  discounts: string | null;
  refunds: string | null;
  platformCommission: string | null;
  taxeSejourAmount: string | null;
}
