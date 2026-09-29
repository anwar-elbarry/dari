import { Job, Queue } from 'bullmq';
import { JOB_PURGE, RetentionProcessor } from './retention.processor';
import { PurgeResult, RetentionService } from './retention.service';

const processor = (result: Partial<PurgeResult>) => {
  const purge = jest.fn().mockResolvedValue({ purged: 0, drafts: 0, failed: 0, overdue: 0, ...result });
  const queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
  return { p: new RetentionProcessor(queue as unknown as Queue, { purge } as unknown as RetentionService), queue, purge };
};
const job = (name: string) => ({ name, data: {} }) as Job;

describe('RetentionProcessor', () => {
  it('schedules the purge every hour', async () => {
    const { p, queue } = processor({});
    await p.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(JOB_PURGE, { every: 3_600_000 }, { name: JOB_PURGE, data: {} });
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
