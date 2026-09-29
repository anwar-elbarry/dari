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
