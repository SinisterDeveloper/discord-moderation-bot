import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { z } from 'zod';
import { MongoStore } from '../src/storage/store.js';
import { importLegacy, inspectLegacy, type LegacySource } from '../src/storage/migration.js';
import { errorCode } from '../src/logger.js';
let source: mongoose.Connection | undefined;
let target: mongoose.Connection | undefined;
try {
  const { values } = parseArgs({
    options: { 'source-db': { type: 'string' }, apply: { type: 'boolean', default: false } },
  });
  const sourceName = z
    .string()
    .regex(/^[\w-]+$/)
    .parse(values['source-db']);
  const targetName = z
    .string()
    .regex(/^[\w-]+$/)
    .max(38)
    .parse(process.env.MONGODB_DATABASE);
  if (sourceName === targetName) throw new Error('Source and target databases must differ.');
  const uri = z
    .string()
    .regex(/^mongodb(?:\+srv)?:\/\//)
    .parse(process.env.MONGODB_URI);
  source = await mongoose
    .createConnection(process.env.SOURCE_MONGODB_URI || uri, {
      dbName: sourceName,
      serverSelectionTimeoutMS: 10_000,
    })
    .asPromise();
  const db = source.db!;
  const legacy: LegacySource = {
    settings: () => db.collection('settings').find({}),
    cases: () => db.collection('modlogs').find({}).sort({ _id: 1 }),
  };
  const report = await inspectLegacy(legacy, sourceName);
  console.log(
    JSON.stringify(
      {
        mode: values.apply ? 'apply' : 'preview',
        sourceDatabase: sourceName,
        targetDatabase: targetName,
        serverCount: report.settings.length,
        caseCount: report.caseCount,
        errors: report.errors,
        errorCount: report.errorCount,
        warnings: report.warnings,
        warningCount: report.warningCount,
        requiredCapabilities: report.requiredCapabilities,
      },
      null,
      2,
    ),
  );
  if (report.errorCount) {
    process.exitCode = 1;
  } else if (values.apply) {
    target = await mongoose
      .createConnection(uri, { dbName: targetName, serverSelectionTimeoutMS: 10_000 })
      .asPromise();
    const store = new MongoStore(target);
    await store.init();
    console.log(JSON.stringify(await importLegacy(legacy, sourceName, store, report)));
  }
} catch (error) {
  console.error(
    `Migration stopped (${errorCode(error)}). Check inputs, database access, and the preview. No source records were changed.`,
  );
  process.exitCode = 1;
} finally {
  await source?.close();
  await target?.close();
}
