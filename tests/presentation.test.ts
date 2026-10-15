import { describe, expect, it } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import { caseEmbed, embedReply, settingsEmbed, textEmbed } from '../src/discord/presentation.js';
import { fixture } from './helpers.js';

function expectValidEmbed(embed: EmbedBuilder) {
  const payload = embed.toJSON();
  expect(payload.title?.length ?? 0).toBeLessThanOrEqual(256);
  expect(payload.description?.length ?? 0).toBeLessThanOrEqual(4096);
  expect(payload.fields?.length ?? 0).toBeLessThanOrEqual(25);
  for (const field of payload.fields ?? []) {
    expect(field.name.length).toBeLessThanOrEqual(256);
    expect(field.value.length).toBeLessThanOrEqual(1024);
  }
  expect(embed.length).toBeLessThanOrEqual(6000);
}
describe('Discord presentation', () => {
  it('fits maximum reasons and recent changes within Discord embed limits', () => {
    const { record } = fixture();
    record.reason = '*'.repeat(400);
    record.state = 'unknown';
    record.changes = Array.from({ length: 100 }, () => ({
      kind: 'reason' as const,
      actorId: record.actorId,
      at: new Date(),
      previous: record.reason,
      value: '*'.repeat(400),
    }));
    const embed = caseEmbed(record, true);
    expectValidEmbed(embed);
    expect(embed.toJSON().description).toContain('Verify the result in Discord');
    expect(embed.toJSON().footer?.text).toContain(record.id);
  });
  it('preserves all 20 role and 50 channel exemptions within field limits', () => {
    const { settings } = fixture();
    settings.exemptRoles = Array.from({ length: 20 }, (_, i) =>
      String(100000000000000000n + BigInt(i)),
    );
    settings.exemptChannels = Array.from({ length: 50 }, (_, i) =>
      String(200000000000000000n + BigInt(i)),
    );
    const embed = settingsEmbed(settings);
    expectValidEmbed(embed);
    const payload = JSON.stringify(embed.toJSON());
    for (const id of [...settings.exemptRoles, ...settings.exemptChannels])
      expect(payload).toContain(id);
  });
  it('creates independent response objects and suppresses mentions', () => {
    const first = embedReply(textEmbed('Saved', 'First result.'));
    const second = embedReply(textEmbed('Saved', 'Second result.'));
    first.embeds[0]!.setTitle('Changed');
    expect(second.embeds[0]!.toJSON().title).toBe('Saved');
    expect(second.content).toBe('');
    expect(second.allowedMentions).toEqual({ parse: [] });
    expect(second.components).toEqual([]);
  });
  it('keeps routine results short and shows delivery faults when needed', () => {
    const { record } = fixture();
    record.state = 'succeeded';
    expect(caseEmbed(record).toJSON().fields).toHaveLength(2);
    record.dm.status = 'failed';
    expect(caseEmbed(record).toJSON().fields).toContainEqual(
      expect.objectContaining({ name: 'Delivery', value: expect.stringContaining('failed') }),
    );
    record.revoked = true;
    expect(caseEmbed(record).toJSON().title).toBe('Warning · Revoked');
  });
});
