// Builds welcome.js (the guide shown on first launch) from docs/Welcome.md.
// Run after editing the guide: npm run welcome
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(join(root, 'docs', 'Welcome.md'), 'utf8').replace(/\r\n/g, '\n');
const escaped = md.split('\\').join('\\\\').split('`').join('\\`').split('${').join('\\${');
writeFileSync(join(root, 'welcome.js'), 'window.INKWELL_WELCOME = `' + escaped + '`;\n');
console.log('welcome.js updated');
