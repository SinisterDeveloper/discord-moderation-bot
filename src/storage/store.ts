import mongoose, { Schema, Types } from 'mongoose';
import type {
  ActionRequest,
  CaseChange,
  CaseState,
  Delivery,
  GuildSettings,
  ModerationCase,
} from '../domain.js';
import { defaultSettings, delivery, UserError } from '../domain.js';

export interface CasePage {
  records: ModerationCase[];
  next: string | null;
}
export interface CaseListOptions {
  actionFilter?: string;
}
export interface Store {
  available(): boolean;
  getSettings(guildId: string): Promise<GuildSettings>;
  saveSettings(settings: GuildSettings): Promise<GuildSettings>;
  insertCase(
    request: ActionRequest,
    settings: GuildSettings,
  ): Promise<{ record: ModerationCase; created: boolean }>;
  getCase(guildId: string, id: string): Promise<ModerationCase | null>;
  searchCases?(guildId: string, query: string, limit?: number): Promise<ModerationCase[]>;
  findRequest(guildId: string, requestKey: string): Promise<ModerationCase | null>;
  transition(
    guildId: string,
    id: string,
    from: CaseState[],
    state: CaseState,
    code?: string | null,
  ): Promise<ModerationCase>;
  listCases(
    guildId: string,
    targetId: string,
    cursor?: string,
    options?: CaseListOptions,
  ): Promise<CasePage>;
  changeCase(
    guildId: string,
    id: string,
    change: CaseChange,
    outcome?: 'succeeded' | 'failed',
  ): Promise<ModerationCase>;
  unresolved(guildId: string): Promise<number>;
  listUnresolved(guildId: string): Promise<Pick<ModerationCase, 'id' | 'action' | 'targetId'>[]>;
  claimStaff(): Promise<ModerationCase | null>;
  finishStaff(
    record: ModerationCase,
    error: string | null,
    permanent: boolean,
    messageId?: string,
  ): Promise<void>;
  claimDM(guildId: string, id: string): Promise<boolean>;
  finishDM(guildId: string, id: string, code: string | null): Promise<void>;
  claimExpired?(now?: Date): Promise<ModerationCase | null>;
  finishExpired?(guildId: string, id: string): Promise<void>;
  countActiveWarnings?(guildId: string, targetId: string, since: Date, now?: Date): Promise<number>;
}

const deliverySchema = new Schema(
  {
    status: {
      type: String,
      enum: ['disabled', 'pending', 'sending', 'sent', 'failed'],
      required: true,
    },
    attempts: { type: Number, required: true },
    nextAttemptAt: { type: Date, required: true },
    errorCode: { type: String, default: null },
    messageId: { type: String, default: null },
  },
  { _id: false },
);
const settingsSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true },
    version: { type: Number, required: true },
    schemaVersion: { type: Number, required: true, enum: [3] },
    logChannelId: { type: String, default: null },
    channels: Schema.Types.Mixed,
    lastCaseNumber: Number,
    dmEnabled: { type: Boolean, required: true },
    accountAge: { type: Schema.Types.Mixed, required: true },
    invites: { type: Schema.Types.Mixed, required: true },
    escalations: Schema.Types.Mixed,
    exemptRoles: [String],
    exemptChannels: [String],
    legacyMuteRoleId: { type: String, default: null },
    automod: { type: Schema.Types.Mixed, required: true },
  },
  { versionKey: false, collection: 'guild_settings_v3', autoIndex: false },
);
const caseSchema = new Schema(
  {
    guildId: { type: String, required: true },
    caseNumber: Number,
    targetId: { type: String, required: true },
    actorId: { type: String, required: true },
    requestKey: { type: String, required: true },
    action: { type: String, required: true },
    source: { type: String, required: true },
    reason: { type: String, required: true },
    state: {
      type: String,
      enum: ['pending', 'executing', 'succeeded', 'failed', 'unknown', 'legacy_unverified'],
      required: true,
    },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    errorCode: { type: String, default: null },
    durationMs: Number,
    expiresAt: Date,
    expiredProcessed: { type: Boolean, default: false },
    deleteMessageSeconds: Number,
    purgeFilter: Schema.Types.Mixed,
    slowmodeSeconds: Number,
    channelId: String,
    messageId: String,
    joinedAt: String,
    runId: String,
    logChannelId: { type: String, default: null },
    dm: deliverySchema,
    staff: deliverySchema,
    revoked: { type: Boolean, default: false },
    changes: { type: [Schema.Types.Mixed], default: [] },
    legacy: Schema.Types.Mixed,
  },
  { versionKey: false, collection: 'moderation_cases_v3', autoIndex: false },
);
caseSchema.index({ guildId: 1, requestKey: 1 }, { unique: true });
caseSchema.index({ guildId: 1, caseNumber: -1 });
caseSchema.index({ guildId: 1, targetId: 1, createdAt: -1, _id: -1 });
caseSchema.index({ guildId: 1, state: 1 });
caseSchema.index({ state: 1, expiredProcessed: 1, expiresAt: 1 });
caseSchema.index({ 'staff.status': 1, 'staff.nextAttemptAt': 1 });

type Raw = Record<string, unknown>;
function asCase(raw: unknown): ModerationCase {
  const doc = raw as Raw;
  const { _id, ...rest } = doc;
  return { ...rest, id: String(_id) } as unknown as ModerationCase;
}
function asSettings(raw: unknown): GuildSettings {
  const { _id: ignored, ...rest } = raw as Raw;
  void ignored;
  return rest as unknown as GuildSettings;
}
export class MongoStore implements Store {
  readonly settings;
  readonly cases;
  constructor(readonly connection: mongoose.Connection) {
    this.settings = connection.model('V3Settings', settingsSchema);
    this.cases = connection.model('V3Case', caseSchema);
  }
  available() {
    return this.connection.readyState === 1;
  }
  async init() {
    await Promise.all([this.settings.createIndexes(), this.cases.createIndexes()]);
  }
  async getSettings(guildId: string) {
    let raw = await this.settings.findOne({ guildId }).lean();
    if (!raw) {
      try {
        await this.settings.updateOne(
          { guildId },
          { $setOnInsert: defaultSettings(guildId) },
          { upsert: true },
        );
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 11000)) throw error;
      }
      raw = await this.settings.findOne({ guildId }).lean();
    }
    if (!raw) throw new Error('Settings could not be loaded.');
    return asSettings(raw);
  }
  async saveSettings(settings: GuildSettings) {
    const { lastCaseNumber: preservedCounter, ...rest } = settings;
    void preservedCounter;
    const next = { ...rest, version: settings.version + 1 };
    const raw = await this.settings
      .findOneAndUpdate(
        { guildId: settings.guildId, version: settings.version },
        { $set: next },
        { returnDocument: 'after', runValidators: true },
      )
      .lean();
    if (!raw)
      throw new UserError(
        'Settings changed during this request. Read them and try again.',
        'CONFLICT',
      );
    return asSettings(raw);
  }
  async insertCase(request: ActionRequest, settings: GuildSettings) {
    const existing = await this.cases
      .findOne({ guildId: request.guildId, requestKey: request.requestKey })
      .lean();
    if (existing) return { record: asCase(existing), created: false };
    const now = new Date();
    const counterDoc = await this.settings
      .findOneAndUpdate(
        { guildId: request.guildId },
        {
          $inc: { lastCaseNumber: 1 },
          $setOnInsert: defaultSettings(request.guildId),
        },
        { upsert: true, returnDocument: 'after' },
      )
      .lean();
    const caseNumber = (counterDoc as Raw | null)?.lastCaseNumber as number | undefined;
    const isAlert = request.action === 'account_age_alert' || request.action === 'invite_delete';
    const targetLogChannel = isAlert
      ? (settings.channels?.alertLog ?? settings.channels?.modLog ?? settings.logChannelId)
      : (settings.channels?.modLog ?? settings.logChannelId);
    try {
      const raw = await this.cases.create({
        ...request,
        ...(caseNumber !== undefined ? { caseNumber } : {}),
        state: 'pending',
        createdAt: now,
        updatedAt: now,
        logChannelId: targetLogChannel,
        dm: delivery(
          settings.dmEnabled &&
            ['ban', 'tempban', 'softban', 'kick', 'warn', 'timeout'].includes(request.action),
        ),
        staff: delivery(false),
      });
      return { record: asCase(raw.toObject()), created: true };
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 11000)) throw error;
      const duplicate = await this.cases
        .findOne({ guildId: request.guildId, requestKey: request.requestKey })
        .lean();
      if (!duplicate) throw error;
      return { record: asCase(duplicate), created: false };
    }
  }
  async getCase(guildId: string, id: string) {
    const trimmed = id.trim();
    if (/^[a-f0-9]{24}$/i.test(trimmed)) {
      const raw = await this.cases.findOne({ guildId, _id: trimmed.toLowerCase() }).lean();
      return raw ? asCase(raw) : null;
    }
    const numMatch = /^#?([1-9]\d*)$/.exec(trimmed);
    if (numMatch) {
      const raw = await this.cases
        .findOne({ guildId, caseNumber: Number(numMatch[1]) })
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      return raw ? asCase(raw) : null;
    }
    return null;
  }
  async searchCases(guildId: string, query: string, limit = 25): Promise<ModerationCase[]> {
    const trimmed = query.trim();
    const filter: Raw = { guildId };
    if (trimmed) {
      const numMatch = /^#?([1-9]\d*)$/.exec(trimmed);
      if (numMatch && trimmed.length <= 10) {
        filter.caseNumber = Number(numMatch[1]);
      } else if (/^\d{17,20}$/.test(trimmed)) {
        filter.targetId = trimmed;
      } else if (/^[a-f0-9]{24}$/i.test(trimmed)) {
        filter._id = trimmed.toLowerCase();
      } else {
        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          { reason: { $regex: escaped, $options: 'i' } },
          { action: { $regex: escaped, $options: 'i' } },
        ];
      }
    }
    const docs = await this.cases
      .find(filter)
      .select('-legacy.raw -changes')
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(limit, 25))
      .lean();
    return docs.map(asCase);
  }
  async findRequest(guildId: string, requestKey: string) {
    const raw = await this.cases.findOne({ guildId, requestKey }).lean();
    return raw ? asCase(raw) : null;
  }
  async transition(
    guildId: string,
    id: string,
    from: CaseState[],
    state: CaseState,
    code: string | null = null,
  ) {
    const record = await this.getCase(guildId, id);
    if (!record) throw new UserError('Case not found.');
    const finish = ['succeeded', 'failed', 'unknown'].includes(state);
    const set: Raw = { state, errorCode: code, updatedAt: new Date() };
    if (finish) {
      set.staff = delivery(record.logChannelId !== null);
      if (state !== 'succeeded') set['dm.status'] = 'disabled';
    }
    const raw = await this.cases
      .findOneAndUpdate(
        { guildId, _id: id, state: { $in: from } },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean();
    if (!raw) throw new UserError('Case state changed. Read the current result.', 'CONFLICT');
    return asCase(raw);
  }
  async listCases(
    guildId: string,
    targetId: string,
    cursor?: string,
    options?: CaseListOptions,
  ): Promise<CasePage> {
    const filter: Raw = { guildId, targetId };
    if (options?.actionFilter && options.actionFilter !== 'all') {
      if (options.actionFilter === 'ban_kick') {
        filter.action = { $in: ['ban', 'tempban', 'softban', 'unban', 'kick'] };
      } else if (options.actionFilter === 'timeout') {
        filter.action = { $in: ['timeout', 'untimeout', 'legacy_mute', 'legacy_unmute'] };
      } else {
        filter.action = options.actionFilter;
      }
    }
    if (cursor) {
      const anchor = await this.getCase(guildId, cursor);
      if (!anchor || anchor.targetId !== targetId) throw new UserError('Invalid page cursor.');
      filter.$or = [
        { createdAt: { $lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, _id: { $lt: new Types.ObjectId(anchor.id) } },
      ];
    }
    const records = (
      await this.cases
        .find(filter)
        .select('-legacy.raw -changes')
        .sort({ createdAt: -1, _id: -1 })
        .limit(11)
        .lean()
    ).map(asCase);
    const hasMore = records.length > 10;
    const page = records.slice(0, 10);
    return { records: page, next: hasMore ? page.at(-1)!.id : null };
  }
  async changeCase(
    guildId: string,
    id: string,
    change: CaseChange,
    outcome?: 'succeeded' | 'failed',
  ) {
    const filter: Raw = { guildId, _id: id, 'changes.99': { $exists: false } };
    const set: Raw = { updatedAt: new Date() };
    if (change.kind === 'reason') {
      filter.reason = change.previous;
      set.reason = change.value;
    }
    if (change.kind === 'revoke') {
      filter.action = 'warn';
      filter.revoked = false;
      filter.state = { $in: ['succeeded', 'legacy_unverified'] };
      set.revoked = true;
    }
    if (change.kind === 'resolve') {
      filter.state = 'unknown';
      filter['staff.status'] = { $ne: 'sending' };
      if (!outcome) throw new UserError('An outcome is required.');
      const record = await this.getCase(guildId, id);
      if (!record) throw new UserError('Case not found in this server.');
      set.state = outcome;
      set.staff = delivery(record.logChannelId !== null);
    }
    const raw = await this.cases
      .findOneAndUpdate(
        filter,
        { $set: set, $push: { changes: change } },
        { returnDocument: 'after' },
      )
      .lean();
    if (!raw)
      throw new UserError(
        'This case cannot be changed. It may have changed or its staff log is still sending. Read it and try again.',
      );
    return asCase(raw);
  }
  async unresolved(guildId: string) {
    return this.cases.countDocuments({ guildId, state: 'unknown' });
  }
  async listUnresolved(guildId: string) {
    const records = await this.cases
      .find({ guildId, state: 'unknown' })
      .select({ _id: 1, action: 1, targetId: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .limit(10)
      .lean();
    return records.map((record) => ({
      id: String(record._id),
      action: record.action as ModerationCase['action'],
      targetId: record.targetId,
    }));
  }
  async recover() {
    for await (const record of this.cases
      .find({ state: { $in: ['pending', 'executing'] } })
      .cursor()) {
      const pending = record.state === 'pending';
      await this.transition(
        record.guildId,
        String(record._id),
        [pending ? 'pending' : 'executing'],
        pending ? 'failed' : 'unknown',
        pending ? 'CANCELLED_BEFORE_EXECUTION' : 'PROCESS_INTERRUPTED',
      );
    }
    await this.cases.updateMany(
      { 'dm.status': { $in: ['sending', 'pending'] } },
      { $set: { 'dm.status': 'failed', 'dm.errorCode': 'PROCESS_INTERRUPTED' } },
    );
    await this.cases.updateMany(
      { 'staff.status': 'sending', 'staff.attempts': { $lt: 3 } },
      { $set: { 'staff.status': 'pending' } },
    );
    await this.cases.updateMany(
      { 'staff.status': 'sending', 'staff.attempts': { $gte: 3 } },
      { $set: { 'staff.status': 'failed', 'staff.errorCode': 'PROCESS_INTERRUPTED' } },
    );
  }
  async claimStaff() {
    const raw = await this.cases
      .findOneAndUpdate(
        {
          'staff.status': 'pending',
          'staff.nextAttemptAt': { $lte: new Date() },
          'staff.attempts': { $lt: 3 },
        },
        { $set: { 'staff.status': 'sending' }, $inc: { 'staff.attempts': 1 } },
        { returnDocument: 'after', sort: { 'staff.nextAttemptAt': 1 } },
      )
      .lean();
    return raw ? asCase(raw) : null;
  }
  async finishStaff(
    record: ModerationCase,
    error: string | null,
    permanent: boolean,
    messageId?: string,
  ) {
    const status: Delivery['status'] = !error
      ? 'sent'
      : permanent || record.staff.attempts >= 3
        ? 'failed'
        : 'pending';
    await this.cases.updateOne(
      { guildId: record.guildId, _id: record.id, 'staff.status': 'sending' },
      {
        $set: {
          'staff.status': status,
          'staff.errorCode': error,
          'staff.messageId': messageId ?? null,
          'staff.nextAttemptAt': new Date(
            Date.now() + (record.staff.attempts === 1 ? 10_000 : 60_000),
          ),
        },
      },
    );
  }
  async claimDM(guildId: string, id: string) {
    const result = await this.cases.updateOne(
      { guildId, _id: id, state: 'succeeded', 'dm.status': 'pending' },
      { $set: { 'dm.status': 'sending' }, $inc: { 'dm.attempts': 1 } },
    );
    return result.modifiedCount === 1;
  }
  async finishDM(guildId: string, id: string, code: string | null) {
    await this.cases.updateOne(
      { guildId, _id: id, 'dm.status': 'sending' },
      { $set: { 'dm.status': code ? 'failed' : 'sent', 'dm.errorCode': code } },
    );
  }
  async claimExpired(now = new Date()) {
    const raw = await this.cases
      .findOneAndUpdate(
        {
          action: { $in: ['tempban', 'lock'] },
          state: 'succeeded',
          expiredProcessed: { $ne: true },
          expiresAt: { $lte: now },
        },
        { $set: { expiredProcessed: true, updatedAt: now } },
        { returnDocument: 'after', sort: { expiresAt: 1 } },
      )
      .lean();
    return raw ? asCase(raw) : null;
  }
  async finishExpired(guildId: string, id: string) {
    await this.cases.updateOne(
      { guildId, _id: id },
      { $set: { expiredProcessed: true, updatedAt: new Date() } },
    );
  }
  async countActiveWarnings(guildId: string, targetId: string, since: Date, now = new Date()) {
    return this.cases.countDocuments({
      guildId,
      targetId,
      action: 'warn',
      state: 'succeeded',
      revoked: false,
      createdAt: { $gte: since },
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
    });
  }
}
