#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { inspectTarget, installBundle, loadBundle, resolveTargets } from '../lib/installer.mjs';

const help = `astro-blog-content-publisher 0.1.0
Usage: astro-blog-content-publisher [install|check|list] [options]

  --agent codex|claude|all  Agent destinations (default: codex)
  --global                Install in the user's agent skills directory
  --target <directory>    Exact skills destination; exclusive with --agent/--global
  --dry-run               Validate and report without writing
  --help                  Show this help
  --version               Show package version

Project: Codex .agents/skills, Claude .claude/skills, relative to cwd.
Global: Codex ~/.codex/skills, Claude ~/.claude/skills.
All installs copy the root skill and every pinned dependency offline.
Existing changed skills are preserved; resolve conflicts manually.
Exit: 0 success, 1 missing/conflicting installation, 2 usage/validation/I/O error.
`;

try {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(help); process.exit(0); }
  if (args.includes('--version')) { console.log('0.1.0'); process.exit(0); }
  let command = 'install';
  if (args[0] && !args[0].startsWith('-')) command = args.shift();
  if (!['install', 'check', 'list'].includes(command)) throw new Error(`Unknown command: ${command}`);
  let agent = 'codex';
  let hasAgent = false;
  let isGlobal = false;
  let target;
  let isDryRun = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--global') isGlobal = true;
    else if (flag === '--dry-run') isDryRun = true;
    else if (flag === '--agent' || flag === '--target') {
      const value = args[++index];
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${flag}`);
      if (flag === '--agent') { agent = value; hasAgent = true; }
      else target = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!['codex', 'claude', 'all'].includes(agent)) throw new Error(`Unknown agent: ${agent}`);
  if (target && (hasAgent || isGlobal)) throw new Error('--target cannot be combined with --agent or --global');
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const bundle = loadBundle(packageRoot);
  if (command === 'list') {
    for (const skill of bundle) console.log(skill.name);
  } else {
    const targets = resolveTargets({ agent, isGlobal, target, cwd: process.cwd(), home: os.homedir() });
    const installation = command === 'install' ? installBundle(bundle, targets, { dryRun: isDryRun }) : { reports: targets.map(destination => ({ target: destination, skills: inspectTarget(bundle, destination) })) };
    for (const report of installation.reports) {
      console.log(report.target);
      for (const skill of report.skills) console.log(`  ${skill.status}: ${skill.name}`);
    }
    const isComplete = installation.reports.every(report => report.skills.every(skill => skill.status === 'installed' || (command === 'install' && isDryRun && skill.status === 'missing')));
    if (isDryRun && command === 'install') console.log('Dry run: no files written.');
    if (!isComplete) process.exitCode = 1;
  }
} catch (error) {
  console.error(`astro-blog-content-publisher: ${error.message}`);
  process.exitCode = 2;
}
