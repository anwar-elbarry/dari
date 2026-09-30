import { Job, Queue } from 'bullmq';
import { StorageService } from '../storage/storage.service';
import { JOB_PURGE, JOB_REWRAP, RetentionProcessor } from './retention.processor';
import { PurgeResult, RetentionService } from './retention.service';

const processor = (result: Partial<PurgeResult>, rewrap: { rewrapped: number; failed: number } = { rewrapped: 0, failed: 0 }) => {
  const purge = jest.fn().mockResolvedValue({ purged: 0, drafts: 0, failed: 0, overdue: 0, ...result });
  const rewrapOutdatedKeys = jest.fn().mockResolvedValue(rewrap);
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

  it('rewraps one bounded run per hour and never touches the purge', async () => {
    const { p, rewrapOutdatedKeys, purge } = processor({}, { rewrapped: 350, failed: 0 });
    await expect(p.process(job(JOB_REWRAP))).resolves.toEqual({ rewrapped: 350 });
    expect(rewrapOutdatedKeys).toHaveBeenCalledTimes(1);
    expect(rewrapOutdatedKeys).toHaveBeenCalledWith(2000); // 10 x 200 objects per run
    expect(purge).not.toHaveBeenCalled();
  });

  it('fails the job when an object could not be rewrapped, so the old master key is not retired unnoticed', async () => {
    const { p } = processor({}, { rewrapped: 10, failed: 1 });
    await expect(p.process(job(JOB_REWRAP))).rejects.toThrow('could not rewrap 1 object(s)');
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
