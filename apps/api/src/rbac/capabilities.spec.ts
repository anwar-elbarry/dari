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
    expect(can('STAFF', 'guest:write')).toBe(false);
  });

  it('keeps every guest capability away from the Accountant', () => {
    for (const c of ['checkin:manage', 'guest:read_meta', 'id:read', 'police:read', 'guest:write'] as const) expect(can('ACCOUNTANT', c)).toBe(false);
  });

  it('keeps registers and Secure Share to Owner/Manager: Staff and Accountant get neither', () => {
    for (const role of ['STAFF', 'ACCOUNTANT'] as const) for (const c of ['register:read', 'share:manage'] as const) expect(can(role, c)).toBe(false);
    for (const c of ['register:read', 'share:manage'] as const) expect(can('OWNER_MANAGER', c)).toBe(true);
  });

  it('gives the Accountant tax reports and nothing else; Staff get none', () => {
    expect(ROLE_CAPABILITIES.ACCOUNTANT).toEqual(['report:read']);
    for (const c of ['report:read', 'report:generate'] as const) expect(can('STAFF', c)).toBe(false);
    expect(can('ACCOUNTANT', 'report:generate')).toBe(false);
    expect(can('OWNER_MANAGER', 'report:generate')).toBe(true);
  });
});
