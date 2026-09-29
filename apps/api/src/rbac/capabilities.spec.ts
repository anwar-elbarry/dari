import { can, CAPABILITIES, ROLE_CAPABILITIES } from './capabilities';

describe('role capabilities', () => {
  it('gives Owner/Manager every capability', () => {
    expect([...ROLE_CAPABILITIES.OWNER_MANAGER].sort()).toEqual([...CAPABILITIES].sort());
  });

  it('keeps Staff away from owners, financial fields and team management', () => {
    for (const c of ['property:read_full', 'property:write', 'owner:read', 'owner:write', 'team:manage', 'booking:write', 'ical:manage', 'revenue:read', 'alert:resolve'] as const) {
      expect(can('STAFF', c)).toBe(false);
    }
    expect(can('STAFF', 'property:read')).toBe(true);
    expect(can('STAFF', 'booking:read')).toBe(true);
  });

  it('lets Staff send links and see check-in status, never ID images or guest fields', () => {
    expect(can('STAFF', 'checkin:manage')).toBe(true);
    expect(can('STAFF', 'guest:read_meta')).toBe(true);
    expect(can('STAFF', 'id:read')).toBe(false);
    expect(can('STAFF', 'police:read')).toBe(false);
  });

  it('keeps every guest capability away from the Accountant', () => {
    for (const c of ['checkin:manage', 'guest:read_meta', 'id:read', 'police:read'] as const) expect(can('ACCOUNTANT', c)).toBe(false);
  });

  it('gives Accountant nothing in Phase 1 (reports arrive in Phase 5)', () => {
    expect(ROLE_CAPABILITIES.ACCOUNTANT).toEqual([]);
  });
});
