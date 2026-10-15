# Upgrade from v2

Use a new v3 database. Stop v2 before the final import. Keep a verified backup of the source database. The migration tools never delete source or target records, collections, or databases.

## Preview

Set `MONGODB_URI` and `MONGODB_DATABASE` for the new target. Set `SOURCE_MONGODB_URI` only if the source is on a different cluster. Do not put credentials in command arguments.

```sh
npm run migrate -- --source-db moderation-bot
```

The preview reads the source `settings` and `modlogs` collections. It does not create target collections. It reports record counts, invalid settings, invalid required IDs, duplicate settings, raw invalid dates, and required capabilities. Fix blocking errors before applying. Review the first 100 reported examples and the total count.

Legacy servers inferred from records have invite filtering enabled. Their migrated minimum-age policy keeps kick mode. Before cutover, set the required runtime capability flags and enable the matching intents in Discord.

The database cannot identify servers that have no settings and no case records. Configure these servers explicitly after upgrade.

## Apply

```sh
npm run migrate -- --source-db moderation-bot --apply
```

The importer uses separate v3 collections and repeatable source keys. Rerunning it adds missing records without replacing existing v3 settings or imported cases. It does not replay Discord actions.

Imported outcomes are `legacy_unverified`, because v2 sometimes recorded failed actions as complete. Legacy indefinite mutes stay `legacy_mute`; they are not converted to timeouts. Unknown legacy actions and missing moderator IDs remain identifiable. Invalid dates retain their raw value and use the source ObjectId timestamp, or the Unix epoch if no timestamp exists.

Compare preview counts with the destination. Inspect samples across servers. Keep the source offline during import so the two scans see a stable source.

## Existing mute roles

The importer retains the legacy role reference. It does not change role members, channel overwrites, or Discord restrictions. Use `/legacy-unmute` to release an individual restriction. The bot needs Manage Roles and a suitable role position. Any replacement timeout requires a separate, explicit duration.

## Export and rollback

```sh
npm run export -- --all --out .local/v3-backup.jsonl
npm run export -- --guild YOUR_SERVER_ID --out .local/server-backup.jsonl
```

Exports stream both collections into a new file with restricted access. They use MongoDB Extended JSON to preserve dates and ObjectIds. Existing files are never overwritten. Treat exports as private moderation data. Keep a separate native MongoDB backup and verify restoration into a new database. The storage tests also restore a JSONL export into a separate temporary database and compare records.

Keep source data through a 30-day rollback window. Before rollback, stop v3 and export its new cases. V2 cannot read v3 collections. Preserve exports for later import or staff review.

Native timeouts and AutoMod rules persist in Discord. Review them before rollback. Do not remove unrelated rules or roles. Prefer fixing forward once new moderation actions have occurred.
