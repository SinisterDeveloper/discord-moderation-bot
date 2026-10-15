import { parseArgs } from 'node:util';
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import mongoose from 'mongoose';
import { z } from 'zod';
import { snowflake } from '../src/config.js';
import { errorCode } from '../src/logger.js';
let connection: mongoose.Connection | undefined;
let output: Awaited<ReturnType<typeof open>> | undefined;
try {
  const { values } = parseArgs({
    options: {
      guild: { type: 'string' },
      all: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  if ((!values.guild && !values.all) || (values.guild && values.all))
    throw new Error('Choose --guild ID or --all.');
  const filter = values.guild ? { guildId: snowflake.parse(values.guild) } : {};
  const file = resolve(z.string().min(1).parse(values.out));
  const uri = z
    .string()
    .regex(/^mongodb(?:\+srv)?:\/\//)
    .parse(process.env.MONGODB_URI);
  const database = z
    .string()
    .regex(/^[\w-]+$/)
    .max(38)
    .parse(process.env.MONGODB_DATABASE);
  connection = await mongoose
    .createConnection(uri, { dbName: database, serverSelectionTimeoutMS: 10_000 })
    .asPromise();
  await mkdir(dirname(file), { recursive: true });
  output = await open(file, 'wx', 0o600);
  let count = 0;
  for (const [kind, name] of [
    ['settings', 'guild_settings_v3'],
    ['case', 'moderation_cases_v3'],
  ] as const) {
    for await (const record of connection.db!.collection(name).find(filter).sort({ _id: 1 })) {
      await output.write(`${mongoose.mongo.BSON.EJSON.stringify({ kind, record })}\n`);
      count++;
    }
  }
  console.log(`Exported ${count} records. The source database was not changed.`);
} catch (error) {
  console.error(
    `Export stopped (${errorCode(error)}). Check inputs and output permissions. Existing files are never overwritten.`,
  );
  process.exitCode = 1;
} finally {
  await output?.close();
  await connection?.close();
}
