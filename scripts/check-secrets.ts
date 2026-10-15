import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const patterns = [
  new RegExp('[A-Za-z0-9_-]{24,}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{25,}'),
  new RegExp('mongodb(?:\\+srv)?://[^\\s/@]+:[^\\s/@]+@'),
];
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
let failed = false;
for (const file of files) {
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch {
    continue;
  }
  if (patterns.some((pattern) => pattern.test(content))) {
    console.error(`Possible credential in tracked file: ${file}`);
    failed = true;
  }
}
const staged = execFileSync('git', ['diff', '--cached', '--no-ext-diff', '--unified=0'], {
  encoding: 'utf8',
  maxBuffer: 20_000_000,
});
if (patterns.some((pattern) => pattern.test(staged))) {
  console.error('Possible credential in staged changes.');
  failed = true;
}
if (failed) process.exitCode = 1;
else console.log('Tracked and staged credential scan passed.');
