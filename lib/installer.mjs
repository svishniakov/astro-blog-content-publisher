import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveTargets({ agent, isGlobal, target, cwd, home }) {
  if (target) return [path.resolve(cwd, target)];
  const agents = agent === 'all' ? ['codex', 'claude'] : [agent];
  return agents.map(name => path.join(isGlobal ? home : cwd, name === 'codex' && !isGlobal ? '.agents' : `.${name}`, 'skills'));
}

function safeRelative(filename) {
  if (typeof filename !== 'string' || !filename || filename.includes('\\') || filename.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(filename)) {
    throw new Error(`Unsafe relative path: ${filename}`);
  }
  return filename;
}

function statIfPresent(filename) {
  try { return fs.lstatSync(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function assertNoSymlinks(filename) {
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (statIfPresent(current)?.isSymbolicLink()) throw new Error(`Symlink traversal refused: ${current}`);
  }
}

function readTree(directory) {
  assertNoSymlinks(directory);
  if (!fs.lstatSync(directory).isDirectory()) throw new Error(`Expected directory: ${directory}`);
  const files = new Map();
  function visit(current, prefix = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const filename = path.join(current, entry.name);
      const stats = fs.lstatSync(filename);
      if (stats.isDirectory()) visit(filename, relative + '/');
      else if (stats.isFile()) files.set(relative, fs.readFileSync(filename));
      else throw new Error(`Unsupported file or symlink: ${filename}`);
    }
  }
  visit(directory);
  return files;
}

function assertSkill(files, name) {
  const markdown = files.get('SKILL.md')?.toString('utf8').replaceAll('\r\n', '\n');
  const frontmatter = markdown?.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  const declaredName = frontmatter?.match(/^name:\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s#]+))\s*$/m)?.slice(1).find(Boolean);
  if (!frontmatter || declaredName !== name || !/^description:[ \t]*(?:\S|\n[ \t]+\S)/m.test(frontmatter)) {
    throw new Error(`Invalid or missing SKILL.md for ${name}`);
  }
}

function assertLocalLinks(files) {
  for (const [filename, bytes] of files) {
    if (!filename.endsWith('.md')) continue;
    for (const match of bytes.toString('utf8').matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(link)) continue;
      const destination = link.split('#')[0];
      if (!destination) continue;
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(filename), destination));
      safeRelative(relative);
      if (!files.has(relative)) throw new Error(`Missing root skill resource: ${filename} -> ${link}`);
    }
  }
}

export function loadBundle(packageRoot) {
  assertNoSymlinks(packageRoot);
  assertNoSymlinks(path.join(packageRoot, 'skills-lock.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'skills-lock.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.skills) || !manifest.skills.length) throw new Error('Invalid skills-lock.json');
  const names = new Set(['astro-blog-content-publisher']);
  const rootFiles = readTree(path.join(packageRoot, 'skills/astro-blog-content-publisher'));
  assertSkill(rootFiles, 'astro-blog-content-publisher');
  assertLocalLinks(rootFiles);
  const bundle = [{ name: 'astro-blog-content-publisher', files: rootFiles }];
  for (const skill of manifest.skills) {
    if (!skillName.test(skill.name) || names.has(skill.name)) throw new Error(`Invalid or duplicate skill name: ${skill.name}`);
    names.add(skill.name);
    if (skill.bundledPath !== `vendor/skills/${skill.name}` || !skill.source || !skill.revision || !skill.sourcePath || !skill.license || !skill.files || typeof skill.files !== 'object' || Array.isArray(skill.files)) throw new Error(`Incomplete manifest entry: ${skill.name}`);
    safeRelative(skill.bundledPath);
    const files = readTree(path.join(packageRoot, skill.bundledPath));
    assertSkill(files, skill.name);
    if (files.size !== Object.keys(skill.files).length) throw new Error(`File list mismatch: ${skill.name}`);
    for (const [relative, expected] of Object.entries(skill.files)) {
      safeRelative(relative);
      if (!/^[a-f0-9]{64}$/.test(expected) || !files.has(relative) || digest(files.get(relative)) !== expected) throw new Error(`Checksum mismatch: ${skill.name}/${relative}`);
    }
    bundle.push({ name: skill.name, files });
  }
  return bundle;
}

function sameFiles(expected, actual) {
  return expected.size === actual.size && [...expected].every(([name, bytes]) => actual.get(name)?.equals(bytes));
}

export function inspectTarget(bundle, target) {
  assertNoSymlinks(target);
  const targetStats = statIfPresent(target);
  if (targetStats && !targetStats.isDirectory()) throw new Error(`Target is not a directory: ${target}`);
  return bundle.map(skill => {
    const destination = path.join(target, skill.name);
    const stats = statIfPresent(destination);
    if (!stats) return { name: skill.name, status: 'missing' };
    try {
      return { name: skill.name, status: sameFiles(skill.files, readTree(destination)) ? 'installed' : 'conflict' };
    } catch { return { name: skill.name, status: 'conflict' }; }
  });
}

export function installBundle(bundle, targets, { dryRun = false } = {}) {
  const reports = targets.map(target => ({ target, skills: inspectTarget(bundle, target) }));
  if (reports.some(report => report.skills.some(skill => skill.status === 'conflict'))) return { ok: false, reports };
  if (dryRun || reports.every(report => report.skills.every(skill => skill.status === 'installed'))) return { ok: true, reports };
  const locks = [];
  const stages = [];
  const created = [];
  try {
    for (const { target } of reports) {
      assertNoSymlinks(target);
      fs.mkdirSync(target, { recursive: true });
      const lock = path.join(target, '.astro-blog-content-publisher.lock');
      fs.mkdirSync(lock);
      locks.push(lock);
      const stage = fs.mkdtempSync(path.join(target, '.astro-blog-content-publisher-'));
      stages.push(stage);
      const statuses = inspectTarget(bundle, target);
      if (statuses.some(skill => skill.status === 'conflict')) throw new Error(`Target changed during installation: ${target}`);
      for (const skill of bundle) {
        if (statuses.find(status => status.name === skill.name).status === 'installed') continue;
        const stagingDirectory = path.join(stage, skill.name);
        fs.mkdirSync(stagingDirectory);
        for (const [relative, bytes] of skill.files) {
          const filename = path.join(stagingDirectory, relative);
          fs.mkdirSync(path.dirname(filename), { recursive: true });
          fs.writeFileSync(filename, bytes, { flag: 'wx' });
        }
      }
    }
    for (let index = 0; index < reports.length; index++) {
      const { target } = reports[index];
      for (const skill of bundle) {
        const staged = path.join(stages[index], skill.name);
        if (!statIfPresent(staged)) continue;
        const destination = path.join(target, skill.name);
        assertNoSymlinks(target);
        if (statIfPresent(destination)) throw new Error(`Destination appeared during installation: ${destination}`);
        fs.renameSync(staged, destination);
        created.push({ destination, inode: fs.lstatSync(destination).ino });
      }
    }
    return { ok: true, reports: targets.map(target => ({ target, skills: inspectTarget(bundle, target) })) };
  } catch (error) {
    for (const { destination, inode } of created.reverse()) {
      const stats = statIfPresent(destination);
      if (stats?.isDirectory() && stats.ino === inode) fs.rmSync(destination, { recursive: true });
    }
    throw error;
  } finally {
    for (const stage of stages) fs.rmSync(stage, { recursive: true, force: true });
    for (const lock of locks.reverse()) fs.rmdirSync(lock);
  }
}
