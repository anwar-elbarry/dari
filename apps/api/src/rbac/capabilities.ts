import type { Role } from '@prisma/client';

/**
 * What each role may do (Tech Spec §7 permission matrix). Routes declare the capability they need
 * with @Requires(); roles never appear in controllers. Later phases add capabilities here
 * (bookings, check-ins, ID documents, tax reports...).
 */
export const CAPABILITIES = [
  'property:read', // list and view properties (Staff get a reduced projection)
  'property:read_full', // owner, tax regime, Taxe de Séjour mode, iCal URL
  'property:write',
  'owner:read',
  'owner:write',
  'team:manage', // invitations now; roles and removal in Phase 6
  'booking:read', // stays, day counter, alerts (Staff: dates and classification only)
  'booking:write', // classification overrides, CSV imports
  'ical:manage', // feeds and their URLs
  'revenue:read', // revenue fields on bookings
  'alert:resolve', // close an alert with a reason
  'checkin:manage', // create, list, resend and revoke guest check-in links (Staff too: they send the link)
  'guest:read_meta', // check-in status per guest (Staff see status only, never the fields)
  'id:read', // read an ID image (Owner/Manager only; every read is audited)
  'guest:write', // correct a guest's fields and mark them verified (Owner/Manager only)
  'police:read', // guest fields on the Fiche and its PDF (Owner/Manager only until counsel confirms Staff access)
  'register:read', // generate, validate and read the monthly police register (Owner/Manager only)
  'share:manage', // create, list and revoke Secure Share links, read their access log (Owner/Manager only)
  'report:read', // monthly tax estimates and their exports: Owner/Manager and Accountant. Never guest data.
  'report:generate', // generate a tax estimate and see its missing inputs (Owner/Manager only)
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  OWNER_MANAGER: CAPABILITIES,
  STAFF: ['property:read', 'booking:read', 'checkin:manage', 'guest:read_meta'],
  // Reports only (Phase 5). No property, owner or guest data.
  ACCOUNTANT: ['report:read'],
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
