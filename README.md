# Discord Moderation Bot v3

A self-hosted Discord moderation bot. Use slash commands, native timeouts, durable case records, and configurable server policies. One Node.js process can serve several Discord servers.

## Requirements

- Node.js 24.22.0, as recorded in `.node-version`.
- MongoDB 8.0 or a compatible MongoDB Atlas cluster. Use a **new database** for v3.
- A Discord application with a bot token.

## Setup

1. Install dependencies and build the application:

   ```sh
   npm ci
   npm run build
   ```

2. Create `.env` from `.env.example` if it does not exist. Set `DISCORD_TOKEN`, `APPLICATION_ID`, `MONGODB_URI`, and `MONGODB_DATABASE`. Keep this file private. The application reads it at startup. The application never needs your Discord user token.

3. Install the application with the `bot` and `applications.commands` scopes. Give it the permissions required by your features:

   | Feature                    | Bot permissions                                     |
   | -------------------------- | --------------------------------------------------- |
   | Staff logs                 | View Channel, Send Messages, Embed Links            |
   | Kick / ban                 | Kick Members / Ban Members                          |
   | Timeouts                   | Moderate Members                                    |
   | Invite filtering           | View Channel, Read Message History, Manage Messages |
   | Native AutoMod             | Manage Server; access to the staff channel          |
   | Imported mute-role release | Manage Roles                                        |

   Put the bot role above the members and legacy roles it must manage. Administrator is not required.

4. For account-age checks, enable **Server Members Intent** in the Developer Portal and set `ENABLE_MEMBER_EVENTS=true`. For invite filtering, enable **Message Content Intent** and set `ENABLE_MESSAGE_FILTER=true`. Restart after changing these flags. Discord may require approval for privileged access.

5. Register commands in a test server first:

   ```sh
   npm run commands:deploy -- --guild YOUR_SERVER_ID
   ```

   For a release, use `npm run commands:deploy -- --global`. Command registration is a separate operation. It is not repeated at reconnect.

6. Start the bot:

   ```sh
   npm start
   ```

7. Run `/setup` to choose a staff channel. Then run `/doctor`. Automated policies start disabled. Enable each policy through `/config` or `/automod` after review.

For development, use `npm run dev`. For a server deployment, run the built application under a process supervisor, such as systemd or your host's service manager. Keep one process per application/database pair. Do not run two copies against the same database: startup recovery assumes one process.

## Commands

| Commands                                                                      | User permission  |
| ----------------------------------------------------------------------------- | ---------------- |
| `/ban`, `/tempban`, `/softban`, `/unban`                                      | Ban Members      |
| `/kick`                                                                       | Kick Members     |
| `/warn`, `/note`, `/timeout`, `/untimeout`, `/whois`, `/cases`, `/case view`  | Moderate Members |
| `Inspect & Moderate` (User Apps Menu), `Moderate Message` (Message Apps Menu) | Moderate Members |
| `/purge`                                                                      | Manage Messages  |
| `/lock`, `/unlock`, `/slowmode`                                               | Manage Channels  |
| `/case reason`, `/case revoke`, `/case resolve`                               | Manage Server    |
| `/legacy-unmute`                                                              | Moderate Members |
| `/panel`, `/setup`, `/config`, `/automod`, `/doctor`                          | Manage Server    |
| `/report`, `Report Message` (Message Apps Menu), `/help`, `/ping`             | Any member       |

- **Interactive Control Center (`/panel`)**: Configure log channels, multi-select exempt roles and channels (`RoleSelectMenu` & `ChannelSelectMenu`), automated policies, warning escalations, and native AutoMod drafts via interactive modals—100% inside Discord without an external web dashboard.
- **Sequential Case Numbers & Autocomplete**: Every server case receives a human-friendly sequential `#caseNumber` alongside its 24-character ObjectId, with live autocomplete on `/case` subcommands, bidirectional pagination and action filtering on `/cases`, and interactive `Amend Reason` / `Revoke Warning` modals on `/case view`.
- **Moderation & Channel Controls**:
  - `/ban`, `/tempban` (up to 365d with automatic scheduled unban), and `/softban` support `delete-days` (`0–7`).
  - `/note` records private staff-only notes on a member without DMing the user.
  - `/whois` displays a member dossier (account age, join date, roles, timeout status, and recent cases) with quick buttons.
  - `/purge` bulk-deletes up to 100 recent messages with optional filters (`user`, `contains`, `bots-only`, `attachments-only`).
  - `/lock` (with optional auto-unlock duration), `/unlock`, and `/slowmode` manage channel rate limits and send permissions.
- **In-Discord DM Appeals & Member Reporting**:
  - Action DMs include a stateless `Submit Appeal` button (`v3a:*` custom IDs) that opens an appeal modal in DMs and routes the submission to staff (`appealLog` or `modLog`) with `Approve & Reverse` and `Reject Appeal` buttons.
  - `/report` and the `Report Message` context menu let members report issues with message snapshots directly to `reportLog`.

## Automated policies

- `/config account-age`: alert or kick accounts below a whole-day threshold. The default setup value is seven days with alert mode. Kick mode also requires the configuring user to have Kick Members.
- `/config anti-raid`: detect join-rate spikes (`threshold` joins within `window-seconds`) and automatically alert staff or kick incoming joiners.
- `/config invites`: delete messages with resolved invites to another server. Valid same-server invites remain. Failed or expired lookups leave the message in place and cause a rate-limited staff alert. Message edits are checked too.
- `/config escalation`: configure warning expiry (`decay-days`) and automated strike thresholds (`threshold` active warnings within `window-days` → `timeout`, `tempban`, `kick`, or `ban`).
- `/config log-channel`: route `modLog`, `alertLog`, `appealLog`, and `reportLog` to dedicated channels or a shared staff channel.
- `/config appeals` and `/config reports`: toggle DM appeals and member reporting and optionally assign dedicated channels.
- `/config audit-sync`: optionally record native Discord AutoMod blocks (`automod_block`) into server case history.
- `/config backup` and `/config restore`: export and import portable server policy configurations as JSON attachments inside Discord.
- `/config exempt-role` and `/config exempt-channel`: manage shared exemptions. Channel exemptions do not affect join checks. Bots and administrators bypass bot-run policies.
- `/automod configure`: save a draft for mention spam (including `raid-protection`), Discord word categories, or keywords (including `regex` patterns, `allow-list`, and `timeout-seconds`).
- `/automod apply`: preview and confirm a native rule. The rule blocks matching messages, sends a native alert, and optionally applies a timeout. Native rules continue while the bot is offline.
- `/automod disable`: preview and disable an owned rule.

The bot never adopts another application's AutoMod rules or replaces a full rule slot. `/doctor` reports missing rules and external changes. Reapply each owned preset after changing exemptions or the staff channel. Native AutoMod has Discord's own exemptions and behavior; these do not exactly match custom bot filters.

`/cases` covers bot actions. Native AutoMod activity uses Discord's alert channel and is not copied into case history. Message content is not stored in bot cases.

## Action outcomes and recovery

Before acting, the bot saves a pending case. It then saves `executing`, calls Discord, and saves `succeeded`, `failed`, or `unknown`. A database outage stops new bot-run actions.

Discord and MongoDB cannot share a transaction. If the process stops during an action, the bot marks it uncertain on restart. Staff must verify the result and use `/case resolve`. Recovery never repeats punishment.

A failed DM does not change an action outcome. DMs are attempted once. Staff logs get two retries after temporary failures. Staff messages may repeat after a crash; case IDs let staff identify them. Read `/case view` for current delivery status.

Health endpoints are `/livez` and `/readyz` on `127.0.0.1:3000` by default. They contain no user data. Readiness requires both Discord and MongoDB.

## Data and upgrades

V3 uses only `guild_settings_v3` and `moderation_cases_v3` in the configured database. It does not remove records, collections, databases, or legacy indexes. Keep database backups. Retention is manual; no automatic deletion job runs.

See [the migration guide](docs/MIGRATION.md) for the optional v2 importer and rollback procedure. Secrets belong in environment configuration. Logs contain error references rather than raw HTTP errors or connection strings.

## Checks

```sh
npm run check
npm run test:storage
```

Storage tests start a temporary local MongoDB 8.0 process with `mongodb-memory-server`. The first run downloads the database binary. They do not use Atlas or require a container engine.

See [live verification](docs/LIVE_TESTS.md) for guarded Discord checks and human-assisted checks. See [the verification record](docs/VERIFICATION.md) for results and pending release checks. Local live reports and exports belong in the ignored `.local` directory.

## Contributing

Use small commits and add tests for permission rules and failure handling. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report bot version, Node.js version, command, permissions, and steps to reproduce. Remove credentials before sharing logs.

Licensed under [Apache-2.0](LICENSE).
