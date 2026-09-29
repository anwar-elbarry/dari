import { can, CAPABILITIES, ROLE_CAPABILITIES } from './capabilities';

describe('role capabilities', () => {
  it('gives Owner/Manager every capability', () => {
    expect([...ROLE_CAPABILITIES.OWNER_MANAGER].sort()).toEqual([...CAPABILITIES].sort());
  });

  it('keeps Staff away from owners, financial fields and team management', () => {
    for (const c of ['property:read_full', 'property:write', 'owner:read', 'owner:write', 'team:manage'] as const) {
      expect(can('STAFF', c)).toBe(false);
    }
    expect(can('STAFF', 'property:read')).toBe(true);
  });

  it('gives Accountant nothing in Phase 1 (reports arrive in Phase 5)', () => {
    expect(ROLE_CAPABILITIES.ACCOUNTANT).toEqual([]);
  });
});
