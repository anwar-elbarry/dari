import { Logger } from '@nestjs/common';
import { scheduleInBackground } from './schedule';

describe('scheduleInBackground', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('logs a failure without the error message and retries until the job is scheduled', async () => {
    const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const register = jest.fn().mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:6379')).mockRejectedValueOnce(new Error('again')).mockResolvedValue(undefined);

    await scheduleInBackground('purge', register, 1_000);
    expect(register).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(register).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(register).toHaveBeenCalledTimes(3); // scheduled: no more attempts

    expect(errors).toHaveBeenCalledTimes(2);
    expect(errors.mock.calls.join(' ')).not.toContain('10.0.0.5');
    expect(errors.mock.calls[0][0]).toContain('"purge"');
    errors.mockRestore();
  });
});
