import { vi } from 'vitest';
import {
  delivery,
  defaultSettings,
  type ActionRequest,
  type ModerationCase,
} from '../src/domain.js';
import type { Store } from '../src/storage/store.js';
import type { DiscordPort } from '../src/moderation/service.js';
export const guildId = '1108716196024561764';
export const targetId = '852903412462387213';
export const actorId = '1278003050107371523';
export function request(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    guildId,
    targetId,
    actorId,
    action: 'warn',
    source: 'manual',
    reason: 'Test reason',
    requestKey: 'test-request',
    ...overrides,
  };
}
export function fixture() {
  const settings = defaultSettings(guildId);
  settings.logChannelId = '1560181480427225159';
  const record: ModerationCase = {
    ...request(),
    id: '0123456789abcdef01234567',
    state: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    errorCode: null,
    logChannelId: settings.logChannelId,
    dm: delivery(true),
    staff: delivery(false),
    revoked: false,
    changes: [],
  };
  const store: Store = {
    available: vi.fn(() => true),
    getSettings: vi.fn(async () => structuredClone(settings)),
    saveSettings: vi.fn(async (s) => s),
    insertCase: vi.fn(async (r) => ({ record: { ...record, ...r }, created: true })),
    getCase: vi.fn(async () => record),
    findRequest: vi.fn(async () => null),
    transition: vi.fn(async (_g, _id, _from, state, code) => {
      record.state = state;
      record.errorCode = code ?? null;
      return structuredClone(record);
    }),
    listCases: vi.fn(async () => ({ records: [], next: null })),
    changeCase: vi.fn(async () => record),
    unresolved: vi.fn(async () => 0),
    listUnresolved: vi.fn(async () => []),
    claimStaff: vi.fn(async () => null),
    finishStaff: vi.fn(async () => {}),
    claimDM: vi.fn(async () => true),
    finishDM: vi.fn(async () => {}),
  };
  const discord: DiscordPort = {
    authorize: vi.fn(async () => 'allowed' as const),
    perform: vi.fn(async () => {}),
    sendDM: vi.fn(async () => {}),
    sendStaff: vi.fn(async () => 'sent'),
  };
  return { settings, record, store, discord };
}
