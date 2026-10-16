import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundle } from '../lib/installer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = loadBundle(root);
console.log(`Validated ${bundle.length} skills and all pinned file checksums.`);
