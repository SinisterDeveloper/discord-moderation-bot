# V3 review evidence

Recorded on 15 October 2026. Work is on `dev`. All commits are local. No push was made.

The implementation and automated checks are complete. Human-assisted Discord checks are still pending. The final v3.0 release also needs code review and a seven-day pilot.

## Automated checks

| Check                                                           | Result                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| Clean `npm ci` from the committed lockfile                      | Passed with Node.js 24.22.0                                    |
| Production build from the clean installation                    | Passed                                                         |
| `npm run check`                                                 | Passed: types, lint, formatting, credentials, tests, build     |
| Unit, service, command, policy, presentation, and runtime tests | 62 passed                                                      |
| `npm run test:storage`                                          | 9 passed against a temporary MongoDB 8.0.17 process            |
| Dependency audit during clean installation                      | No vulnerabilities reported                                    |
| Normal application startup with Atlas and Discord               | Passed                                                         |
| Normal application health endpoints                             | Liveness and readiness returned 200; unknown path returned 404 |

Storage checks include separate-server histories, concurrent duplicate requests, stable pagination, settings conflicts, interrupted actions, atomic staff resolution, delivery retry limits, repeat imports, and restoration into a new database. The export test runs the actual CLI. It checks dates, IDs, case changes, settings, source record counts, and refusal to overwrite an existing file.

Service checks include denied permissions, confirmation expiry, changed permissions after confirmation, missing capabilities, database loss before execution, uncertain outcomes, failed DMs, invite lookup faults, uncached message edits, and owned AutoMod conflicts and recovery. Expected failure tests emit controlled error references.

No container engine or container deployment is used. Storage tests do not use cloud credentials. GitHub-hosted CI and CodeQL have not run on these local commits; they run after the user pushes.

## Live API and service evidence

Tests used only server `1108716196024561764`, channel `1560181480427225159`, and disposable member `852903412462387213`.

The final service run, `2026-10-15T07-55-46-925Z-26a9ad`, passed 14 checks:

- Authentication, separate Atlas test database access, scope, role order, permissions, and Gateway connection.
- Warning storage, duplicate-request handling, case history, reason amendment, and warning revocation.
- Native timeout and removal, and release of a temporary legacy mute role.
- Creation and disabling of each owned AutoMod preset: keywords, mentions, and Discord word filters.
- Staff log delivery.

All six cleanup steps passed. The run removed its three rules and temporary role, restored the target's timeout, and restored test settings. Test cases remain in MongoDB.

Membership run `2026-10-15T07-42-17-399Z-235d44` passed kick, off-server ban by ID, and unban. The user confirmed rejoin. A later live preflight also confirmed that the member is present.

These checks use the bot API and shared services. They do not prove real slash commands or user message behavior.

## Human-assisted checks

The first command test window expired before the user tried `/ping`. No successful real interaction was recorded in that window. The runner now supports `--seconds 0`, so it can stay connected until the tester stops it.

Run `2026-10-15T08-01-47-949Z-e9de61` recorded successful real `/ping`, `/doctor`, and `/cases` interactions. The user confirmed that replies work and requested clearer formatting. Command replies, confirmations, errors, moderation DMs, and bot staff logs now use one compact embed. Detailed delivery and change history appear in `/case view`; delivery failures also appear in action results. Embed size checks cover maximum reasons, recent changes, and all allowed exemptions. This checks the payload limits in [Discord's message reference](https://docs.discord.com/developers/resources/message#embed-object).

Discord accepted an embed preview of an existing test case. A read-back check confirmed one embed, two fields, the case reference, no plain-text body, and no mentions. No moderation action was repeated or database record changed for this check. The private evidence is `.local/embed-format-proof.json`.

The restricted interactive runner is open for human checks. It uses the separate test database, saves a settings snapshot, starts policies disabled, and tracks its own resources. Its settings are temporary until that run ends. Stop it with Ctrl+C after testing so cleanup can finish.

Still required:

- Visual review of the new embeds in Discord. Real setup, warning, case view, amendment, revocation, timeout, and timeout removal. Verify private replies and denied permissions in Discord.
- Same-server and external invite messages, including edits and failed lookups.
- A real native keyword block and Discord staff alert.
- Account-age alert and kick on join, with human rejoin checkpoints.
- Cleanup confirmation for the open interactive run.

API tests, simulated tests, and human checks must remain separate in the release decision. Do not mark these pending checks as passed from this document alone.

## Data and credentials

Runtime credentials are in the ignored local `.env` file. Live reports and exports are under the ignored `.local` directory. They are not committed.

The new normal database is `discord_moderation_v3_20261015_8ffeb3`. The separate live test database is `dmb_v3_test_20261015_8ffeb3_e2e`. V3 uses `guild_settings_v3` and `moderation_cases_v3`. No database records, collections, or databases were deleted. Existing v2 data was not migrated in the supplied cluster. A production cutover still needs a named source database, a verified backup, preview, comparison, and staff review.

The importer and export/restore procedure were rehearsed with isolated local fixtures. A managed Atlas snapshot restoration was not performed. Keep the 30-day rollback window described in [the migration guide](MIGRATION.md).

## Local implementation commits

| Commit    | Change                                                                    |
| --------- | ------------------------------------------------------------------------- |
| `167610e` | TypeScript runtime, configuration, and checks                             |
| `69ae70a` | Durable cases and uncertain-action recovery                               |
| `cf5479c` | Slash moderation, permissions, confirmations, and history                 |
| `d51b468` | Settings, invite and account-age policies, and native AutoMod             |
| `604730e` | Non-destructive v2 import and export                                      |
| `0a78239` | Guarded live verification, documentation, and release preparation         |
| `079bf29` | Isolated test runs, run IDs, clear input errors, and untimed human checks |
| `7befbd8` | Uncertain case references in `/doctor`                                    |

The documentation checkpoint follows these implementation commits. Use `git log --oneline 7c5c228..HEAD` to see the complete local history.

## Reference documentation

The implementation was checked against the current [Discord AutoMod reference](https://docs.discord.com/developers/resources/auto-moderation) and [discord.js 14.27.0 documentation](https://discord.js.org/docs/packages/discord.js/14.27.0). See [setup](../README.md) and [the live test procedure](LIVE_TESTS.md) for repeatable commands.
