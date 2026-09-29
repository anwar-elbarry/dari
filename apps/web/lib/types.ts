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
