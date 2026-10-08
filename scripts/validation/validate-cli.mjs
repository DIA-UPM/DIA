// `npm run validate` — validates all JSON content without building.
import path from 'node:path';
import { loadAndValidate } from './validate.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const { data, errors } = loadAndValidate(ROOT, { throwOnError: false });
if (errors.length) {
  console.error(`✖ ${errors.length} problem(s) found in data/:\n` + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`✔ Content is valid: ${Object.keys(data.news).length} news, ${Object.keys(data.personnel).length} people, ${Object.keys(data).length - 2} page/data files.`);
