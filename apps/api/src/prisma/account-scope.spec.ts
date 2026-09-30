import { AccountScopeError, scopeArgs } from './account-scope';

const A = 'acc-a';

describe('scopeArgs', () => {
  it('adds accountId to reads, updates and deletes', () => {
    for (const op of ['findUnique', 'findFirst', 'findMany', 'count', 'update', 'updateMany', 'delete', 'deleteMany']) {
      expect(scopeArgs('Property', op, { where: { id: 'p1' } }, A).where).toEqual({ id: 'p1', accountId: A });
    }
    expect(scopeArgs('Property', 'findMany', {}, A).where).toEqual({ accountId: A });
  });

  it('sets accountId on create and createMany', () => {
    expect(scopeArgs('Property', 'create', { data: { name: 'x' } }, A).data).toEqual({ name: 'x', accountId: A });
    expect(scopeArgs('Property', 'createMany', { data: [{ name: 'x' }] }, A).data).toEqual([{ name: 'x', accountId: A }]);
  });

  it('refuses another account in where or data', () => {
    expect(() => scopeArgs('Property', 'findMany', { where: { accountId: 'acc-b' } }, A)).toThrow(AccountScopeError);
    expect(() => scopeArgs('Property', 'create', { data: { accountId: 'acc-b' } }, A)).toThrow(AccountScopeError);
  });

  it('never lets an update move a row to another account', () => {
    expect(() => scopeArgs('Property', 'update', { where: { id: 'p' }, data: { accountId: A } }, A)).toThrow(AccountScopeError);
  });

  it('scopes upsert on both where and create', () => {
    const args = scopeArgs('Property', 'upsert', { where: { id: 'p' }, create: { name: 'x' }, update: { name: 'y' } }, A);
    expect(args.where).toEqual({ id: 'p', accountId: A });
    expect(args.create).toEqual({ name: 'x', accountId: A });
  });

  it('refuses nested relation writes', () => {
    expect(() => scopeArgs('Property', 'create', { data: { name: 'x', owner: { connect: { id: 'o' } } } }, A)).toThrow(/nested write/);
    expect(() => scopeArgs('Property', 'update', { where: { id: 'p' }, data: { owner: { update: { name: 'y' } } } }, A)).toThrow(/nested write/);
    expect(scopeArgs('Property', 'update', { where: { id: 'p' }, data: { updatedAt: new Date(0) } }, A).where).toEqual({ id: 'p', accountId: A });
  });

  it('refuses models without a scope rule', () => {
    expect(() => scopeArgs('ChecklistTemplateStep', 'findMany', {}, A)).toThrow(/no account scope rule/);
    expect(() => scopeArgs('Account', 'findMany', {}, A)).toThrow(/no account scope rule/);
  });
});
