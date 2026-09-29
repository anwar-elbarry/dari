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
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  OWNER_MANAGER: CAPABILITIES,
  STAFF: ['property:read'],
  // Reports only, from Phase 5. No property, owner or guest data.
  ACCOUNTANT: [],
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
