import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeReports } from './report.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: npm run report:regenerate -- k6/results/<run-directory>');
const root = path.resolve(directory);
const [summary, metadata] = await Promise.all(['summary.json', 'metadata.json'].map(async name => JSON.parse(await readFile(path.join(root, name), 'utf8'))));
const status = await writeReports(root, summary, metadata);
console.log(`${status}: regenerated saved HTML/PDF reports in ${root}. No load test executed.`);
