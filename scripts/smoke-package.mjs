import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadBundle } from '../lib/installer.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = loadBundle(packageRoot);
const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'astro-publisher-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(args, cwd = temporary, expected = 0) {
  const execution = spawnSync(npm, args, { cwd, encoding: 'utf8', timeout: 60000 });
  assert.equal(execution.status, expected, `${args.join(' ')}\n${execution.error?.message ?? ''}\n${execution.stdout}\n${execution.stderr}`);
  return execution.stdout;
}

try {
  const [packed] = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], packageRoot));
  assert.ok(packed.files.every(file => !file.path.startsWith('.agent-work/') && !file.path.startsWith('test/') && !file.path.endsWith('.tgz')));
  const tarball = path.join(temporary, packed.filename);
  const target = path.join(temporary, 'skills');
  const invoke = (...args) => run(['exec', '--offline', '--yes', '--cache', path.join(temporary, 'npm-cache'), '--package', tarball, '--', 'astro-blog-content-publisher', ...args]);
  invoke('install', '--target', target, '--dry-run');
  assert.equal(fs.existsSync(target), false);
  invoke('install', '--target', target);
  assert.equal(fs.readdirSync(target).length, bundle.length);
  invoke('check', '--target', target);
  const rootSkill = path.join(target, 'astro-blog-content-publisher/SKILL.md');
  const inode = fs.statSync(rootSkill).ino;
  invoke('install', '--target', target);
  assert.equal(fs.statSync(rootSkill).ino, inode);
  fs.appendFileSync(rootSkill, '\nLocal edit\n');
  run(['exec', '--offline', '--yes', '--cache', path.join(temporary, 'npm-cache'), '--package', tarball, '--', 'astro-blog-content-publisher', 'install', '--target', target], temporary, 1);
  assert.ok(fs.readFileSync(rootSkill, 'utf8').endsWith('Local edit\n'));
  console.log(`npm pack + offline npx validated: ${bundle.length} skills, dry-run, check, repeat install, preserved conflict.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
