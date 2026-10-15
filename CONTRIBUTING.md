# Contributing

Use Node.js 24.22.0 and npm. Install from the lockfile with `npm ci`.

Run `npm run check` before committing. Run `npm run test:storage` for storage or migration changes. Storage tests use a temporary local MongoDB process and never require cloud credentials.

Keep commands thin. Put permission and target rules in the moderation layer. Put Discord access behind adapters. Query every case by its trusted server ID. Do not add automatic retries for punitive actions.

Test failures that can mislead staff: duplicate events, uncertain API results, database loss, denied permissions, closed DMs, and missing log channels. Keep changes small enough to review.

Use `.env` for local secrets and `.local` for private reports. Never commit credentials or moderation exports. `npm run secrets:check` scans tracked and staged content. Check staged changes before committing.

A pull request should state the behavior change, its reason, and the checks completed. Mark live checks separately from simulated tests. Do not claim a real interaction passed when only an API call was tested.
