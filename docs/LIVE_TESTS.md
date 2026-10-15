# Live verification

The live runner is restricted to the approved review environment:

- Server: `1108716196024561764`
- Channel: `1560181480427225159`
- Disposable human target: `852903412462387213`

It rejects another scope, an owner or bot target, unsuitable role order, or missing permissions. For another environment, review and explicitly change the allowlist before running it.

Set credentials in `.env`. Set `LIVE_DATABASE` to a new database name ending in `_e2e`, different from `MONGODB_DATABASE`. Use at most 38 characters. Test cases remain for review. No database records, collections, or databases are deleted.

## Read-only preflight

```sh
npm run test:live -- --mode preflight
```

This checks bot identity, Atlas access, scope, permissions, and the target. It does not create database collections or Discord resources.

## Service and API checks

```sh
npm run test:live -- --mode services
```

This verifies a saved warning, request deduplication, history, amendment, revocation, timeout and release, legacy-role release, owned AutoMod application, and staff-log delivery. These are API/service tests. They do not prove real slash-command or message-policy behavior.

Each run uses fresh preset identifiers and starts bot-run policies disabled. It tags API, command, and policy cases with its run ID. The runner restores the target's original timeout and test settings. It removes only roles and AutoMod rules created by the run. Reports identify cleanup failures. If a process is forcibly killed before cleanup, use its case records, test role name, rule ownership markers, and review notes to restore the baseline. Do not remove pre-existing resources.

## Real interactions and policy events

```sh
npm run commands:deploy -- --guild 1108716196024561764
npm run test:live -- --mode interactive --seconds 0
```

The runner accepts interactions only in the approved server and channel. Moderation targets only the disposable member. Policy listeners also restrict checks to that member. Enable member events and message content access in the Developer Portal first. With `--seconds 0`, it stays connected until you stop it with Ctrl+C. For a timed run, choose 30–1800 seconds. Keep it connected while a person tests commands, then stop it to restore settings and remove test resources.

A moderator must invoke `/ping`, `/doctor`, `/setup`, `/warn`, `/cases`, `/case view`, case amendments, and timeout commands in Discord. Confirm that replies remain private. Test denied permissions with a suitable human participant. Do not use user-account automation.

For invite checks, enable `/config invites`, then have the disposable member send and edit same-server and external invite messages in the approved channel. Verify that only external invites are removed.

For native rules, configure a unique test keyword, apply its preset, and have the member send it. Verify the Discord block notice and native alert. The runner records owned native execution events without message content.

For account-age checks, set alert mode and a threshold greater than the target's account age, up to 3,650 days. Have the member leave and rejoin. Verify the recorded alert. Kick mode needs another rejoin and should be tested last.

The interactive report records handled commands and observed policy outcomes. A handled request is not proof that every requested moderation action succeeded; inspect the saved case outcome too. Pending human checks must remain listed as pending.

## Membership removal

```sh
npm run test:live -- --mode membership
# Have the target rejoin after kick, ban by ID, and unban are complete.
```

To test the steps separately:

```sh
npm run test:live -- --mode kick
# The target must rejoin before the next test.
npm run test:live -- --mode ban
```

Ban mode also unbans the target. Each mode leaves a human rejoin checkpoint. The bot cannot restore membership without user participation.

## Evidence

Reports are saved under `.local/live-*.json` with restricted access. They contain check names, case references, scope, and cleanup results. They never contain credentials. Keep automated checks, API checks, human-assisted interactions, and untested steps separate in release notes.

After review, run a seven-day pilot before the final v3.0 release.
