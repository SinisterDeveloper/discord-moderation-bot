import { describe, expect, it, vi } from 'vitest';
import { ActionFailure } from '../src/domain.js';
import { ModerationService } from '../src/moderation/service.js';
import { DeliveryWorker } from '../src/delivery.js';
import { fixture, request } from './helpers.js';
describe('durable action execution', () => {
  it('returns a recorded kick result even after the member has left', async () => {
    const f = fixture();
    vi.mocked(f.store.findRequest).mockResolvedValue({
      ...f.record,
      action: 'kick',
      state: 'succeeded',
    });
    vi.mocked(f.discord.authorize).mockRejectedValue(new Error('Member left.'));
    const result = await new ModerationService(f.store, f.discord).execute(
      request({ action: 'kick' }),
    );
    expect(result.duplicate).toBe(true);
    expect(f.discord.authorize).not.toHaveBeenCalled();
    expect(f.discord.perform).not.toHaveBeenCalled();
  });
  it('rejects a duplicate key for a different target', async () => {
    const f = fixture();
    vi.mocked(f.store.findRequest).mockResolvedValue(f.record);
    await expect(
      new ModerationService(f.store, f.discord).execute(
        request({ targetId: '1108716196024561765' }),
      ),
    ).rejects.toThrow('another action');
    expect(f.discord.perform).not.toHaveBeenCalled();
  });
  it('saves executing before calling Discord and success before DM delivery', async () => {
    const f = fixture();
    vi.mocked(f.discord.perform).mockImplementation(async () => {
      expect(f.record.state).toBe('executing');
    });
    vi.mocked(f.discord.sendDM).mockImplementation(async () => {
      expect(f.record.state).toBe('succeeded');
    });
    const result = await new ModerationService(f.store, f.discord).execute(request());
    expect(result.record?.state).toBe('succeeded');
  });
  it('does not perform an action if the pending record cannot be saved', async () => {
    const f = fixture();
    vi.mocked(f.store.insertCase).mockRejectedValue(new Error('offline'));
    await expect(new ModerationService(f.store, f.discord).execute(request())).rejects.toThrow();
    expect(f.discord.perform).not.toHaveBeenCalled();
  });
  it('does not perform an action if the executing state cannot be saved', async () => {
    const f = fixture();
    vi.mocked(f.store.transition).mockRejectedValue(new Error('offline'));
    await expect(new ModerationService(f.store, f.discord).execute(request())).rejects.toThrow();
    expect(f.discord.perform).not.toHaveBeenCalled();
  });
  it('stops when the database is unavailable', async () => {
    const f = fixture();
    vi.mocked(f.store.available).mockReturnValue(false);
    await expect(new ModerationService(f.store, f.discord).execute(request())).rejects.toThrow(
      'unavailable',
    );
    expect(f.discord.authorize).not.toHaveBeenCalled();
  });
  it('does not replay a duplicate request', async () => {
    const f = fixture();
    vi.mocked(f.store.insertCase).mockResolvedValue({ record: f.record, created: false });
    const result = await new ModerationService(f.store, f.discord).execute(request());
    expect(result.duplicate).toBe(true);
    expect(f.discord.perform).not.toHaveBeenCalled();
  });
  it('records explicit failure and uncertain network results separately', async () => {
    for (const [certain, state] of [
      [true, 'failed'],
      [false, 'unknown'],
    ] as const) {
      const f = fixture();
      vi.mocked(f.discord.perform).mockRejectedValue(new ActionFailure('TEST_ERROR', certain));
      const result = await new ModerationService(f.store, f.discord).execute(request());
      expect(result.record?.state).toBe(state);
      expect(f.discord.sendDM).not.toHaveBeenCalled();
    }
  });
  it('preserves uncertainty when the final database write fails', async () => {
    const f = fixture();
    const transition = vi.mocked(f.store.transition).getMockImplementation()!;
    vi.mocked(f.store.transition)
      .mockImplementationOnce(transition)
      .mockRejectedValueOnce(new Error('offline'));
    const result = await new ModerationService(f.store, f.discord).execute(request());
    expect(result.record?.state).toBe('unknown');
    expect(f.discord.perform).toHaveBeenCalledTimes(1);
  });
  it('keeps success when a DM fails', async () => {
    const f = fixture();
    vi.mocked(f.discord.sendDM).mockRejectedValue(new ActionFailure('50007', true));
    const result = await new ModerationService(f.store, f.discord).execute(request());
    expect(result.record?.state).toBe('succeeded');
    expect(f.store.finishDM).toHaveBeenCalledWith(request().guildId, f.record.id, '50007');
  });
  it('prevents simultaneous actions for the same member', async () => {
    const f = fixture();
    let release!: () => void;
    vi.mocked(f.discord.perform).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const service = new ModerationService(f.store, f.discord);
    const first = service.execute(request());
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(service.execute(request({ requestKey: 'other' }))).rejects.toThrow('running');
    release();
    await first;
  });
  it('returns a no-op without writing a case', async () => {
    const f = fixture();
    vi.mocked(f.discord.authorize).mockResolvedValue('noop');
    expect((await new ModerationService(f.store, f.discord).execute(request())).noop).toBe(true);
    expect(f.store.insertCase).not.toHaveBeenCalled();
  });
});
describe('staff delivery', () => {
  it('never repeats moderation to retry a notification', async () => {
    const f = fixture();
    vi.mocked(f.store.claimStaff).mockResolvedValueOnce(f.record);
    vi.mocked(f.discord.sendStaff).mockRejectedValue(new ActionFailure('50013', true));
    await new DeliveryWorker(f.store, f.discord).tick();
    expect(f.store.finishStaff).toHaveBeenCalledWith(f.record, '50013', true);
    expect(f.discord.perform).not.toHaveBeenCalled();
  });
});
