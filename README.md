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
   | Staff logs                 | View Channel, Send Messages                         |
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

| Commands                                                  | User permission  |
| --------------------------------------------------------- | ---------------- |
| `/ban`, `/unban`                                          | Ban Members      |
| `/kick`                                                   | Kick Members     |
| `/warn`, `/timeout`, `/untimeout`, `/cases`, `/case view` | Moderate Members |
| `/case reason`, `/case revoke`, `/case resolve`           | Manage Server    |
| `/legacy-unmute`                                          | Moderate Members |
| `/setup`, `/config`, `/automod`, `/doctor`                | Manage Server    |
| `/help`, `/ping`                                          | Any member       |

Reasons are required. Ban and kick need confirmation within 60 seconds. Timeouts accept values such as `30m`, `12h`, or `7d`, up to 28 days. New indefinite role mutes are not supported.

Command replies are private. Case IDs are stable. History shows 10 cases per page. Case changes retain the previous value and the actor. A warning can be revoked; other Discord actions must be reversed with their matching commands. Each case supports up to 100 amendments.

The mixed `/case` command group uses checks for each subcommand. Other restricted command groups also set Discord permission defaults. Server integration settings can change command visibility, but cannot bypass runtime checks.

## Automated policies

- `/config account-age`: alert or kick accounts below a whole-day threshold. The default setup value is seven days with alert mode. Kick mode also requires the configuring user to have Kick Members.
- `/config invites`: delete messages with resolved invites to another server. Valid same-server invites remain. Failed or expired lookups leave the message in place and cause a rate-limited staff alert. Message edits are checked too.
- `/config exempt-role` and `/config exempt-channel`: manage shared exemptions. Channel exemptions do not affect join checks. Bots and administrators bypass bot-run policies.
- `/automod configure`: save a draft for mention spam, Discord word categories, or keywords.
- `/automod apply`: preview and confirm a native rule. The rule blocks matching messages and sends a native alert. Native rules continue while the bot is offline.
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

See [live verification](docs/LIVE_TESTS.md) for guarded Discord checks and human-assisted checks. Local live reports and exports belong in the ignored `.local` directory.

## Contributing

Use small commits and add tests for permission rules and failure handling. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report bot version, Node.js version, command, permissions, and steps to reproduce. Remove credentials before sharing logs.

Licensed under [Apache-2.0](LICENSE).
