import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectTarget, installBundle, loadBundle, resolveTargets } from '../lib/installer.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'astro-publisher-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const packageRoot = path.join(directory, 'package');
  function write(relative, text) {
    const filename = path.join(packageRoot, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, text);
  }
  const root = '---\nname: astro-blog-content-publisher\ndescription: Publish a blog.\n---\n';
  const companion = '---\nname: companion\ndescription: Companion skill.\n---\n';
  write('skills/astro-blog-content-publisher/SKILL.md', root);
  write('vendor/skills/companion/SKILL.md', companion);
  write('vendor/skills/companion/references/guide.md', 'Useful guide.\n');
  const manifest = { schemaVersion: 1, skills: [{ name: 'companion', source: 'https://example.com/skills', revision: 'abc123', sourcePath: 'skills/companion', license: 'MIT', bundledPath: 'vendor/skills/companion', files: {
    'SKILL.md': createHash('sha256').update(companion).digest('hex'),
    'references/guide.md': createHash('sha256').update('Useful guide.\n').digest('hex'),
  } }] };
  write('skills-lock.json', JSON.stringify(manifest));
  return { directory, packageRoot, write, manifest, target: path.join(directory, 'destination') };
}

test('installs every skill and resource, then leaves identical files untouched', t => {
  const { packageRoot, target } = fixture(t);
  const bundle = loadBundle(packageRoot);
  assert.equal(installBundle(bundle, [target]).ok, true);
  assert.ok(inspectTarget(bundle, target).every(skill => skill.status === 'installed'));
  const filename = path.join(target, 'companion/SKILL.md');
  const inode = fs.statSync(filename).ino;
  assert.equal(installBundle(bundle, [target]).ok, true);
  assert.equal(fs.statSync(filename).ino, inode);
  assert.deepEqual(fs.readdirSync(target).sort(), ['astro-blog-content-publisher', 'companion']);
});

test('dry-run validates the bundle without creating a target', t => {
  const { packageRoot, target } = fixture(t);
  const report = installBundle(loadBundle(packageRoot), [target], { dryRun: true });
  assert.equal(report.ok, true);
  assert.equal(fs.existsSync(target), false);
  assert.ok(report.reports[0].skills.every(skill => skill.status === 'missing'));
});

test('accepts quoted frontmatter names, CRLF and folded descriptions', t => {
  const sample = fixture(t);
  sample.write('skills/astro-blog-content-publisher/SKILL.md', '---\r\nname: "astro-blog-content-publisher"\r\ndescription: >-\r\n  Publish articles.\r\n---\r\n');
  assert.equal(loadBundle(sample.packageRoot).length, 2);
});

test('preserves changed skills and makes no partial install in any target', t => {
  const { packageRoot, target, directory } = fixture(t);
  fs.mkdirSync(path.join(target, 'companion'), { recursive: true });
  fs.writeFileSync(path.join(target, 'companion/SKILL.md'), 'My own skill');
  const other = path.join(directory, 'other');
  const report = installBundle(loadBundle(packageRoot), [other, target]);
  assert.equal(report.ok, false);
  assert.equal(fs.existsSync(other), false);
  assert.equal(fs.readFileSync(path.join(target, 'companion/SKILL.md'), 'utf8'), 'My own skill');
  assert.equal(fs.existsSync(path.join(target, 'astro-blog-content-publisher')), false);
});

test('modified or added bundled files fail before writes', t => {
  const sample = fixture(t);
  sample.write('vendor/skills/companion/SKILL.md', 'tampered');
  assert.throws(() => loadBundle(sample.packageRoot));
  assert.equal(fs.existsSync(sample.target), false);
  const added = fixture(t);
  added.write('vendor/skills/companion/extra.txt', 'unlisted');
  assert.throws(() => loadBundle(added.packageRoot), /File list mismatch/);
});

test('rejects manifest traversal and malformed root skills', t => {
  const sample = fixture(t);
  sample.manifest.skills[0].files['../escape'] = '0'.repeat(64);
  sample.write('skills-lock.json', JSON.stringify(sample.manifest));
  assert.throws(() => loadBundle(sample.packageRoot));
  const root = fixture(t);
  root.write('skills/astro-blog-content-publisher/SKILL.md', '# no metadata');
  assert.throws(() => loadBundle(root.packageRoot), /Invalid or missing SKILL/);
  const resource = fixture(t);
  fs.appendFileSync(path.join(resource.packageRoot, 'skills/astro-blog-content-publisher/SKILL.md'), '\n[Guide](references/missing.md)');
  assert.throws(() => loadBundle(resource.packageRoot), /Missing root skill resource/);
});

test('refuses source symlinks, target ancestor symlinks and existing skill symlinks', t => {
  const sample = fixture(t);
  const bundle = loadBundle(sample.packageRoot);
  const outside = path.join(sample.directory, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, sample.target);
  assert.throws(() => installBundle(bundle, [sample.target]), /Symlink traversal/);
  fs.unlinkSync(sample.target);
  fs.mkdirSync(sample.target);
  fs.symlinkSync(outside, path.join(sample.target, 'companion'));
  assert.equal(installBundle(bundle, [sample.target]).ok, false);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.symlinkSync(outside, path.join(sample.packageRoot, 'vendor/skills/companion/link'));
  assert.throws(() => loadBundle(sample.packageRoot), /Unsupported file or symlink/);
});

test('installer lock preserves unrelated contents and blocks concurrent installs', t => {
  const { packageRoot, target } = fixture(t);
  fs.mkdirSync(path.join(target, '.astro-blog-content-publisher.lock'), { recursive: true });
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
  assert.throws(() => installBundle(loadBundle(packageRoot), [target]), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');
  assert.ok(fs.existsSync(path.join(target, '.astro-blog-content-publisher.lock')));
});

test('CLI reports missing check and preserves conflict exit status', t => {
  const sample = fixture(t);
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const directory of ['bin', 'lib']) fs.cpSync(path.join(sourceRoot, directory), path.join(sample.packageRoot, directory), { recursive: true });
  const run = (...args) => spawnSync(process.execPath, [path.join(sample.packageRoot, 'bin/astro-blog-content-publisher.mjs'), ...args], { encoding: 'utf8' });
  assert.equal(run('check', '--target', sample.target).status, 1);
  assert.equal(run('install', '--target', sample.target, '--dry-run').status, 0);
  assert.equal(fs.existsSync(sample.target), false);
  assert.equal(run('--target', sample.target).status, 0);
  assert.equal(run('check', '--target', sample.target).status, 0);
  fs.appendFileSync(path.join(sample.target, 'companion/SKILL.md'), '\nEdited');
  assert.equal(run('check', '--target', sample.target).status, 1);
  assert.equal(run('--target', sample.target).status, 1);
  assert.equal(run('--target', sample.target, '--global').status, 2);
  assert.equal(run('--agent', 'unknown').status, 2);
});

test('CLI agent scopes install into documented project directories', t => {
  const sample = fixture(t);
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const directory of ['bin', 'lib']) fs.cpSync(path.join(sourceRoot, directory), path.join(sample.packageRoot, directory), { recursive: true });
  const workingDirectory = path.join(sample.directory, 'project');
  fs.mkdirSync(workingDirectory);
  const run = (...args) => spawnSync(process.execPath, [path.join(sample.packageRoot, 'bin/astro-blog-content-publisher.mjs'), ...args], {
    cwd: workingDirectory, encoding: 'utf8',
  });
  assert.equal(run('--agent', 'all').status, 0);
  for (const agentDirectory of ['.agents', '.claude']) assert.ok(fs.existsSync(path.join(workingDirectory, agentDirectory, 'skills/companion/SKILL.md')));
});

test('resolves global destinations without writing user directories', () => {
  assert.deepEqual(resolveTargets({ agent: 'all', isGlobal: true, cwd: '/project', home: '/user' }), ['/user/.codex/skills', '/user/.claude/skills']);
  assert.deepEqual(resolveTargets({ agent: 'codex', isGlobal: false, cwd: '/project', home: '/user' }), ['/project/.agents/skills']);
});
