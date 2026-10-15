# V3 implementation record

The source review covered all 19 original JavaScript files, schemas, dependencies, configuration, documentation, and maintenance workflow. The review found command-dispatch faults, incorrect mute-role reuse, shared response objects, lost cross-server cache entries, incorrect own-server invite detection, and case outcomes that could disagree with Discord.

The implementation follows the approved v3 plan with these later user choices:

- Work and make local commits directly on `dev`.
- Use no container engine or container deployment files.
- Use the supplied Atlas cluster through private runtime configuration.
- Use newly named databases and v3 collections.
- Never delete database records, collections, or databases.
- Keep test records for review and leave pushing to the user.

## Architecture

One Node.js process uses strict TypeScript, discord.js v14/API v10, Mongoose 9, Zod, and Pino. Modules separate commands, moderation rules, Discord access, policies, storage, and delivery. Tests use Vitest and a temporary native MongoDB 8 process.

Manual actions save a case before contacting Discord. Recovery marks uncertain outcomes for staff review. Notifications have separate outcomes. Native AutoMod manages only owned presets. Existing role mutes are imported without changing their restrictions.

## Delivery checkpoints

1. Runtime, configuration, commands, and CI foundation.
2. Durable cases, server isolation, recovery, and notification delivery.
3. Manual slash commands, permission checks, confirmations, and case changes.
4. Configurable account-age, invite, and native AutoMod policies.
5. Read-only migration preview, repeatable import, and export.
6. Documentation, guarded live checks, review, and release preparation.

Each stage has a local Git checkpoint. See Git history for exact commits.

## Acceptance

Automated checks must pass. Live service checks and human-assisted checks must have separate evidence. Reports must state pending work and cleanup failures. Keep the bot token and database credentials out of Git and logs.

See [setup](../README.md), [migration](MIGRATION.md), and [live verification](LIVE_TESTS.md). A seven-day pilot follows code review before the final v3.0 release.
