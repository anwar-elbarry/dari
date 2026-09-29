import { Job, Queue } from 'bullmq';
import { StorageService } from '../storage/storage.service';
import { JOB_PURGE, JOB_REWRAP, RetentionProcessor } from './retention.processor';
import { PurgeResult, RetentionService } from './retention.service';

const processor = (result: Partial<PurgeResult>, rewraps: number[] = [0]) => {
  const purge = jest.fn().mockResolvedValue({ purged: 0, drafts: 0, failed: 0, overdue: 0, ...result });
  const rewrapOutdatedKeys = jest.fn();
  for (const n of rewraps) rewrapOutdatedKeys.mockResolvedValueOnce(n);
  const queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
  return { p: new RetentionProcessor(queue as unknown as Queue, { purge } as unknown as RetentionService, { rewrapOutdatedKeys } as unknown as StorageService), queue, purge, rewrapOutdatedKeys };
};
const job = (name: string) => ({ name, data: {} }) as Job;

describe('RetentionProcessor', () => {
  it('schedules the purge and the key rewrap every hour', async () => {
    const { p, queue } = processor({});
    await p.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(JOB_PURGE, { every: 3_600_000 }, { name: JOB_PURGE, data: {} });
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(JOB_REWRAP, { every: 3_600_000 }, { name: JOB_REWRAP, data: {} });
  });

  it('rewraps in batches until nothing is left, and never touches the purge', async () => {
    const { p, rewrapOutdatedKeys, purge } = processor({}, [200, 150, 0]);
    await expect(p.process(job(JOB_REWRAP))).resolves.toEqual({ rewrapped: 350 });
    expect(rewrapOutdatedKeys).toHaveBeenCalledTimes(3);
    expect(purge).not.toHaveBeenCalled();
  });

  it('caps the work of one rewrap run', async () => {
    const { p, rewrapOutdatedKeys } = processor({}, Array(50).fill(200));
    await p.process(job(JOB_REWRAP));
    expect(rewrapOutdatedKeys).toHaveBeenCalledTimes(10);
  });

  it('returns the summary when the purge is clean', async () => {
    const { p } = processor({ purged: 3 });
    await expect(p.process(job(JOB_PURGE))).resolves.toMatchObject({ purged: 3 });
  });

  it('fails the job when any object could not be purged, so it is retried and visible', async () => {
    const { p } = processor({ failed: 2 });
    await expect(p.process(job(JOB_PURGE))).rejects.toThrow('failed for 2 object(s)');
  });

  it('ignores other job names', async () => {
    const { p, purge } = processor({});
    await expect(p.process(job('something-else'))).resolves.toBeNull();
    expect(purge).not.toHaveBeenCalled();
  });
});
