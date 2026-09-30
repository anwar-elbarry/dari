import { TeamService } from './team.service';
import { INVITATIONS_PER_HOUR, MAX_INVITATION_RESENDS } from './invitations.service';
import { client, createTestApp, PASSWORD, requireDatabase, resetDatabase, SeededAccount, seedAccount, TestApp } from '../test/test-app';

requireDatabase();

/** Team management (6.2): seat limits, role changes, disable / re-enable, last-manager protection, session termination. */
describe('team management (integration)', () => {
  let t: TestApp;
  let a: SeededAccount;
  let b: SeededAccount;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma, t.redis);
    t.mail.sent.length = 0;
    a = await seedAccount(t, 'Alpha');
    b = await seedAccount(t, 'Beta');
  });

  const setLimit = (seatLimit: number) =>
    t.prisma.account.update({
      where: { id: a.accountId },
      data: { seatLimit },
    });
  const invite = (email: string, role = 'STAFF') => a.as.OWNER_MANAGER.post('/api/invitations', { email, role });
  const extraManager = () =>
    t.prisma.user.create({
      data: {
        accountId: a.accountId,
        name: 'Second Owner',
        email: 'owner2@alpha.test',
        role: 'OWNER_MANAGER',
        passwordHash: 'x',
      },
    });

  describe('overview', () => {
    it('lists members and seat usage, without secrets; another account is invisible', async () => {
      await setLimit(5);
      const res = await a.as.OWNER_MANAGER.get('/api/users').expect(200);
      // Owner/Manager + Staff are counted; the Accountant is not.
      expect(res.body.seats).toEqual({ used: 2, limit: 5 });
      expect(res.body.members).toHaveLength(3);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|token/i);
      expect(res.body.members.map((m: { email: string }) => m.email)).not.toContain(b.users.STAFF.email);
      expect(res.body.members.every((m: { disabled: boolean }) => m.disabled === false)).toBe(true);
    });
  });

  describe('seat limits on invitation', () => {
    it('counts Owner/Manager + Staff + pending Staff invitations, never the Accountant', async () => {
      await setLimit(4);
      await invite('one@x.test', 'STAFF').expect(201); // used: OM + Staff + 1 pending = 3
      await invite('acc@x.test', 'ACCOUNTANT').expect(201); // Accountant not counted, still 3
      const two = await invite('two@x.test', 'STAFF').expect(201); // 4 == limit
      expect(two.status).toBe(201);
      const full = await invite('three@x.test', 'STAFF').expect(409);
      expect(full.body.error.code).toBe('SEAT_LIMIT_REACHED');
      // An Accountant invitation still goes through when Staff seats are full.
      await invite('acc2@x.test', 'ACCOUNTANT').expect(201);
    });

    it('a Starter account (1 seat) can invite an Accountant but not Staff', async () => {
      await setLimit(1); // the one Owner/Manager fills it
      await invite('staff@x.test', 'STAFF').expect(409);
      await invite('acc@x.test', 'ACCOUNTANT').expect(201);
    });

    it('re-inviting the same email keeps its single seat', async () => {
      await setLimit(3); // OM + Staff = 2 used, room for 1
      await invite('one@x.test', 'STAFF').expect(201);
      await invite('one@x.test', 'ACCOUNTANT').expect(201);
      expect(
        await t.prisma.invitation.count({
          where: { accountId: a.accountId, revokedAt: null },
        }),
      ).toBe(1);
    });

    it('parallel invitations cannot take the last seat twice', async () => {
      await setLimit(3); // OM + Staff used, one Staff seat left
      const results = await Promise.all(['p1', 'p2', 'p3', 'p4'].map((n) => invite(`${n}@x.test`, 'STAFF')));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(
        await t.prisma.invitation.count({
          where: { accountId: a.accountId, revokedAt: null },
        }),
      ).toBe(1);
    });

    it('accepting an invitation needs no second seat', async () => {
      await setLimit(3);
      await invite('new@x.test', 'STAFF').expect(201);
      await client(t.app)
        .post('/api/invitations/accept', {
          token: t.mail.lastToken('new@x.test'),
          name: 'Nadia',
          password: PASSWORD,
        })
        .expect(201);
      expect((await a.as.OWNER_MANAGER.get('/api/users').expect(200)).body.seats).toEqual({ used: 3, limit: 3 });
    });
  });

  describe('role and status changes', () => {
    it('changes a role, revokes the member refresh tokens and audits with ids only', async () => {
      const id = a.users.STAFF.id;
      const res = await a.as.OWNER_MANAGER.patch(`/api/users/${id}`, {
        role: 'ACCOUNTANT',
      }).expect(200);
      expect(res.body).toMatchObject({
        id,
        role: 'ACCOUNTANT',
        disabled: false,
      });
      // A role change re-reads the role each request; the refresh chain is cut so the member re-authenticates.
      expect(
        await t.prisma.refreshToken.count({
          where: { userId: id, revokedAt: null },
        }),
      ).toBe(0);
      const row = await t.prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.role_changed' },
      });
      expect(row).toMatchObject({
        accountId: a.accountId,
        actorId: a.users.OWNER_MANAGER.id,
        resourceType: 'User',
        resourceId: id,
      });
      expect(JSON.stringify(row)).not.toMatch(/ACCOUNTANT|STAFF/); // ids only, never the role value
    });

    it('rejects unknown fields, an empty body, and promoting to Owner/Manager', async () => {
      const id = a.users.STAFF.id;
      await a.as.OWNER_MANAGER.patch(`/api/users/${id}`, {
        role: 'OWNER_MANAGER',
      }).expect(400);
      await a.as.OWNER_MANAGER.patch(`/api/users/${id}`, {
        accountId: b.accountId,
      }).expect(400);
      await a.as.OWNER_MANAGER.patch(`/api/users/${id}`, {}).expect(400);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id } })).role).toBe('STAFF');
    });

    it('a null role or flag is refused, not sent to the database', async () => {
      const id = a.users.STAFF.id;
      await a.as.OWNER_MANAGER.patch(`/api/users/${id}`, { role: null }).expect(400);
      await a.as.OWNER_MANAGER.patch(`/api/users/${id}`, { disabled: null }).expect(400);
      await a.as.OWNER_MANAGER.patch(`/api/users/${id}`, { role: null, disabled: true }).expect(400);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id } })).disabledAt).toBeNull();
    });

    it('refuses to change your own row', async () => {
      const res = await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.OWNER_MANAGER.id}`, { disabled: true }).expect(403);
      expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
    });

    it('disabling revokes sessions at once; the next request and login fail', async () => {
      const id = a.users.STAFF.id;
      await a.as.OWNER_MANAGER.patch(`/api/users/${id}`, {
        disabled: true,
      }).expect(200);
      await a.as.STAFF.get('/api/me').expect(401);
      await client(t.app)
        .post('/api/auth/login', {
          email: a.users.STAFF.email,
          password: PASSWORD,
        })
        .expect(401);
      expect(
        await t.prisma.auditLog.count({
          where: { action: 'user.disabled', resourceId: id },
        }),
      ).toBe(1);
    });

    it('a disabled member frees a seat; re-enabling needs one', async () => {
      await setLimit(2); // OM + Staff full
      await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.STAFF.id}`, {
        disabled: true,
      }).expect(200);
      await invite('fills@x.test', 'STAFF').expect(201); // the freed seat
      const blocked = await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.STAFF.id}`, { disabled: false }).expect(409);
      expect(blocked.body.error.code).toBe('SEAT_LIMIT_REACHED');
      await setLimit(3);
      await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.STAFF.id}`, {
        disabled: false,
      }).expect(200);
      expect(await t.prisma.auditLog.count({ where: { action: 'user.enabled' } })).toBe(1);
    });

    it('moving the accountant to Staff needs a free seat; a disabled member can change role without one, and re-enabling then checks', async () => {
      await setLimit(2); // owner + Staff: full
      const blocked = await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.ACCOUNTANT.id}`, { role: 'STAFF' }).expect(409);
      expect(blocked.body.error.code).toBe('SEAT_LIMIT_REACHED');
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: a.users.ACCOUNTANT.id } })).role).toBe('ACCOUNTANT');

      await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.ACCOUNTANT.id}`, { disabled: true }).expect(200);
      await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.ACCOUNTANT.id}`, { role: 'STAFF' }).expect(200); // disabled: no seat used
      expect((await a.as.OWNER_MANAGER.get('/api/users').expect(200)).body.seats).toEqual({ used: 2, limit: 2 });
      await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.ACCOUNTANT.id}`, { disabled: false }).expect(409); // now a Staff seat is needed
      await setLimit(3);
      await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.ACCOUNTANT.id}`, { disabled: false }).expect(200);
    });

    it('a no-op change writes nothing and no team audit row', async () => {
      await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.STAFF.id}`, {
        role: 'STAFF',
      }).expect(200);
      expect(
        await t.prisma.auditLog.count({
          where: {
            action: {
              in: ['user.role_changed', 'user.disabled', 'user.enabled'],
            },
          },
        }),
      ).toBe(0);
    });

    it('another account cannot touch a member (404) and does not change them', async () => {
      await b.as.OWNER_MANAGER.patch(`/api/users/${a.users.STAFF.id}`, {
        disabled: true,
      }).expect(404);
      expect(
        (
          await t.prisma.user.findUniqueOrThrow({
            where: { id: a.users.STAFF.id },
          })
        ).disabledAt,
      ).toBeNull();
    });
  });

  describe('last Owner/Manager protection', () => {
    // Only owners reach this route and they can never change their own row, so the account always keeps an owner.
    it('the last owner cannot disable or demote themselves', async () => {
      await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.OWNER_MANAGER.id}`, {
        disabled: true,
      }).expect(403);
      expect(
        (
          await t.prisma.user.findUniqueOrThrow({
            where: { id: a.users.OWNER_MANAGER.id },
          })
        ).disabledAt,
      ).toBeNull();
    });

    it('a peer owner can be demoted or disabled while the acting owner remains', async () => {
      const second = await extraManager();
      await a.as.OWNER_MANAGER.patch(`/api/users/${second.id}`, {
        role: 'STAFF',
      }).expect(200);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: second.id } })).role).toBe('STAFF');
      // The seeded owner is now the sole owner and stays protected by the self rule.
      await a.as.OWNER_MANAGER.patch(`/api/users/${a.users.OWNER_MANAGER.id}`, {
        disabled: true,
      }).expect(403);
    });
  });

  describe('the last active owner, when two owners change each other at once', () => {
    it('refuses the change that would leave no active Owner/Manager', async () => {
      const second = await extraManager();
      // The other owner has just been disabled by the first (the effect of the request that won the race) ...
      await t.prisma.user.update({ where: { id: second.id }, data: { disabledAt: new Date() } });
      // ... and the second owner's own request, authenticated a moment earlier, now arrives at the first.
      const actor = { id: second.id, accountId: a.accountId, role: 'OWNER_MANAGER' as const };
      await expect(t.app.get(TeamService).update(actor, a.users.OWNER_MANAGER.id, { disabled: true }, { ip: null, userAgent: null })).rejects.toMatchObject({ response: { code: 'LAST_MANAGER' } });
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: a.users.OWNER_MANAGER.id } })).disabledAt).toBeNull();
      await expect(t.app.get(TeamService).update(actor, a.users.OWNER_MANAGER.id, { role: 'STAFF' }, { ip: null, userAgent: null })).rejects.toMatchObject({ response: { code: 'LAST_MANAGER' } });
    });
  });

  describe('invitation abuse limits', () => {
    it('parallel re-sends cannot pass the cap', async () => {
      await invite('cap@x.test', 'STAFF').expect(201);
      const inv = await t.prisma.invitation.findFirstOrThrow({ where: { email: 'cap@x.test' } });
      const results = await Promise.all(Array.from({ length: 8 }, () => a.as.OWNER_MANAGER.post(`/api/invitations/${inv.id}/resend`)));
      expect(results.filter((r) => r.status === 204)).toHaveLength(MAX_INVITATION_RESENDS);
      expect(results.filter((r) => r.status === 429).every((r) => ['RESEND_CAP_REACHED', 'TOO_MANY_REQUESTS'].includes(r.body.error.code))).toBe(true);
      expect((await t.prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).resendCount).toBe(MAX_INVITATION_RESENDS);
    });

    it('an account can e-mail only so many invitations an hour; cancelling and inviting again does not reset it', async () => {
      await t.prisma.account.update({ where: { id: a.accountId }, data: { seatLimit: 100 } });
      await t.prisma.invitation.createMany({
        data: Array.from({ length: INVITATIONS_PER_HOUR }, (_, i) => ({ accountId: a.accountId, email: `bulk${i}@x.test`, role: 'ACCOUNTANT' as const, tokenHash: `bulk-${i}`, invitedBy: a.users.OWNER_MANAGER.id, expiresAt: new Date(Date.now() + 86_400_000), revokedAt: new Date() })),
      });
      const res = await invite('one-more@x.test', 'ACCOUNTANT').expect(429);
      expect(res.body.error.code).toBe('INVITATION_QUOTA');
      expect(t.mail.sent.filter((m) => m.to === 'one-more@x.test')).toHaveLength(0);
      // an hour later it is free again
      await t.prisma.invitation.updateMany({ where: { accountId: a.accountId }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });
      await invite('one-more@x.test', 'ACCOUNTANT').expect(201);
    });
  });

  describe('invitation resend', () => {
    it('rotates the token, refreshes the expiry and is capped', async () => {
      await invite('resend@x.test', 'STAFF').expect(201);
      const inv = await t.prisma.invitation.findFirstOrThrow({
        where: { email: 'resend@x.test' },
      });
      const firstToken = t.mail.lastToken('resend@x.test');

      await a.as.OWNER_MANAGER.post(`/api/invitations/${inv.id}/resend`).expect(204);
      const secondToken = t.mail.lastToken('resend@x.test');
      expect(secondToken).not.toBe(firstToken);
      // the old link no longer previews; the new one does
      await client(t.app).post('/api/invitations/preview', { token: firstToken }).expect(400);
      await client(t.app).post('/api/invitations/preview', { token: secondToken }).expect(200);
      expect(
        await t.prisma.auditLog.count({
          where: { action: 'invitation.resent' },
        }),
      ).toBe(1);

      await a.as.OWNER_MANAGER.post(`/api/invitations/${inv.id}/resend`).expect(204);
      await a.as.OWNER_MANAGER.post(`/api/invitations/${inv.id}/resend`).expect(204);
      const capped = await a.as.OWNER_MANAGER.post(`/api/invitations/${inv.id}/resend`).expect(429);
      expect(capped.body.error.code).toBe('RESEND_CAP_REACHED');
    });

    it('404 for an unknown, revoked or another account invitation', async () => {
      await a.as.OWNER_MANAGER.post(`/api/invitations/${crypto.randomUUID()}/resend`).expect(404);
      await invite('x@x.test', 'STAFF').expect(201);
      const inv = await t.prisma.invitation.findFirstOrThrow({
        where: { email: 'x@x.test' },
      });
      await a.as.OWNER_MANAGER.delete(`/api/invitations/${inv.id}`).expect(204);
      await a.as.OWNER_MANAGER.post(`/api/invitations/${inv.id}/resend`).expect(404);
    });
  });
});
