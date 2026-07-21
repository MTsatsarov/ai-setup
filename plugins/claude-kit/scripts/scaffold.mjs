#!/usr/bin/env node
/**
 * scaffold.mjs — plan.json -> a real application on disk
 *
 * The counterpart to render.mjs. That script writes .claude/ (offline, fast,
 * cannot fail); this one runs the stack's own CLIs (slow, networked, can fail
 * halfway). Keeping them separate is deliberate: a failed scaffold must still
 * leave a usable payload behind.
 *
 *   node scripts/scaffold.mjs --plan <path> --root <dir> --dry-run
 *   node scripts/scaffold.mjs --plan <path> --root <dir> [--from <n>] [--force]
 *
 * Assumes the plan is already valid and fully expanded — resolve.mjs owns every
 * compatibility rule and guarantees no <% %> tag survives into scaffold.*.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { render } from './lib/erb.mjs';
import { PLUGIN_ROOT, readJson, isMainModule } from './lib/library.mjs';

/* ------------------------------------------------------------------ build */

/**
 * The whole plan of action as plain data — nothing here touches disk or the
 * network. --dry-run prints exactly this, which is what makes the preview the
 * user approves identical to what actually runs.
 */
export function buildScaffoldPlan(plan, root) {
  const sc = plan.scaffold ?? { commands: [], conventions: [], env: {} };

  const requires = sc.requires ?? [];

  const commands = (sc.commands ?? []).map((c, i) => ({
    step: i + 1,
    run: c.run,
    cwd: c.cwd ? join(root, c.cwd) : root,
    note: c.note,
    from: c.from,
  }));

  const conventions = (sc.conventions ?? []).map((c) => ({
    src: join(PLUGIN_ROOT, c.from),
    dest: join(root, c.to),
    rel: c.to,
    phase: c.phase ?? 'post',
    from: c.fragment,
  }));

  const env = Object.entries(sc.env ?? {});

  return {
    requires,
    commands,
    conventions,
    pre: conventions.filter((c) => c.phase === 'pre'),
    post: conventions.filter((c) => c.phase !== 'pre'),
    env,
    envPath: join(root, '.env.example'),
  };
}

/* ------------------------------------------------------------------ print */

function describe(sp) {
  const out = [];
  if (sp.requires.length) {
    out.push('Requires:');
    for (const r of sp.requires) out.push(`  ${r.tool} >= ${r.min}  (${r.from})`);
    out.push('');
  }
  if (sp.pre.length) {
    out.push(`Written first (${sp.pre.length}) — commands below depend on these:`);
    for (const c of sp.pre) out.push(`  ${c.rel}`);
    out.push('');
  }

  out.push(`Commands (${sp.commands.length}) — run in order, stopping at the first failure:`);
  for (const c of sp.commands) {
    out.push(`  ${String(c.step).padStart(2)}. ${c.run}`);
    if (c.note) out.push(`      note: ${c.note}`);
  }
  if (!sp.commands.length) out.push('  (none)');

  out.push('');
  out.push(`Convention files (${sp.post.length}) — rendered from the library, then written:`);
  for (const c of sp.post) out.push(`  ${c.rel}`);
  if (!sp.post.length) out.push('  (none)');

  if (sp.env.length) {
    out.push('');
    out.push(`Environment (.env.example, ${sp.env.length} key(s)):`);
    for (const [k] of sp.env) out.push(`  ${k}`);
  }
  return out.join('\n');
}

/* -------------------------------------------------------------- preflight */

const parseVersion = (s) => (s.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1, 4).map(Number);

/** a >= b, comparing major.minor.patch. */
function atLeast(a, b) {
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/**
 * Version floors are checked before anything runs. The Angular CLI refuses to
 * start on an old Node, and finding that out at command 4 of 6 leaves a
 * half-scaffolded directory for no reason.
 */
function checkRequirements(reqs) {
  const problems = [];
  for (const { tool, min, from } of reqs) {
    const r = spawnSync(tool, ['--version'], { encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      problems.push(`${tool} is required (>= ${min}, for ${from}) but is not installed`);
      continue;
    }
    const found = parseVersion(r.stdout ?? '');
    if (!found.length) continue; // unparseable output — do not block on a guess
    if (!atLeast(found, parseVersion(min))) {
      problems.push(`${tool} ${found.join('.')} is too old — ${from} needs >= ${min}`);
    }
  }
  return problems;
}

/* -------------------------------------------------------------- execution */

function runCommands(sp, from) {
  for (const c of sp.commands) {
    if (c.step < from) {
      console.log(`  ${String(c.step).padStart(2)}. (skipped, --from ${from})`);
      continue;
    }
    console.log(`\n→ [${c.step}/${sp.commands.length}] ${c.run}`);
    mkdirSync(c.cwd, { recursive: true });

    // stdin is /dev/null, never inherited. A scaffold command that decides to
    // prompt — `shadcn init` grew an interactive picker that -y does not
    // suppress — would otherwise block forever with no output explaining why.
    // Closed stdin turns that hang into either a default or a clean failure.
    // The timeout is the backstop for a network stall that never returns.
    const r = spawnSync('/bin/sh', ['-c', c.run], {
      cwd: c.cwd,
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 15 * 60 * 1000,
    });

    if (r.error) {
      const why =
        r.error.code === 'ETIMEDOUT'
          ? 'timed out after 15 minutes — it may be waiting on input or a stalled download'
          : r.error.message;
      console.error(`\nStep ${c.step} failed to run: ${why}`);
      return c.step;
    }
    if (r.status !== 0) {
      console.error(`\nStep ${c.step} exited ${r.status}:  ${c.run}`);
      console.error(`  (contributed by ${c.from}, run in ${c.cwd})`);
      return c.step;
    }
  }
  return 0;
}

/**
 * Convention files are TEMPLATES, not static copies — 5 of the 11 in the
 * library contain <% %> tags (namespaces, project names). Rendering them here
 * with the strict backstop is what keeps a stray tag out of a .cs file.
 */
function writeConventions(list, vars) {
  const created = [];
  const replaced = [];
  for (const c of list) {
    // Conventions ALWAYS win. They are the whole point of the layer: `nest new`
    // writes a bare main.ts, and ours replaces it with the Swagger + global
    // ValidationPipe version the fragment promises. Skipping when the file
    // already existed silently produced a project missing exactly the things
    // that were scaffolded to be there. The guard against clobbering someone's
    // real work lives in assertEmptyRoot(), which is the right altitude.
    const existed = existsSync(c.dest);
    const body = render(readFileSync(c.src, 'utf8'), vars, c.src);
    mkdirSync(dirname(c.dest), { recursive: true });
    writeFileSync(c.dest, body);
    (existed ? replaced : created).push(c.rel);
  }
  return { created, replaced };
}

/**
 * Scaffolding is only ever correct into a fresh directory. Everything the
 * convention layer overwrites is assumed to have been produced moments earlier
 * by our own commands — so the one thing that must be verified up front is
 * that we are not standing in somebody's existing project.
 */
function assertEmptyRoot(root) {
  if (!existsSync(root)) return null;
  const ignorable = new Set(['.git', '.claude', '.claude-kit', '.DS_Store']);
  const entries = readdirSync(root).filter((e) => !ignorable.has(e));
  return entries.length ? entries : null;
}

function writeEnvExample(sp) {
  if (!sp.env.length) return false;
  const body =
    '# Generated by claude-kit. Copy to .env and fill in real values.\n' +
    sp.env.map(([k, v]) => `${k}=${v}`).join('\n') +
    '\n';
  writeFileSync(sp.envPath, body);
  return true;
}

/* ------------------------------------------------------------------- cli */

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const has = (name) => argv.includes(`--${name}`);

  const planPath = arg('plan');
  if (!planPath) {
    console.error(
      'usage: scaffold.mjs --plan <path> --root <dir> [--dry-run] [--from <n>] [--force]',
    );
    return 2;
  }
  const root = resolvePath(arg('root') ?? process.cwd());
  const plan = readJson(planPath);
  const sp = buildScaffoldPlan(plan, root);

  if (!sp.commands.length && !sp.conventions.length) {
    console.log('Nothing to scaffold — no selected fragment declares scaffold commands.');
    return 0;
  }

  if (has('dry-run')) {
    console.log(`Would scaffold into ${root}\n`);
    console.log(describe(sp));
    const unmet = checkRequirements(sp.requires);
    if (unmet.length) {
      console.log('\nThis machine does not meet the requirements yet:');
      for (const p of unmet) console.log(`  ✗ ${p}`);
    }
    console.log('\nNothing was written — this was --dry-run.');
    return 0;
  }

  const unmet = checkRequirements(sp.requires);
  if (unmet.length) {
    console.error('Cannot scaffold — unmet requirements:');
    for (const p of unmet) console.error(`  ✗ ${p}`);
    console.error('\nNothing was written. Upgrade the tool above and re-run.');
    return 1;
  }

  const resuming = Number(arg('from') ?? 0) > 0;
  const occupied = has('force') || resuming ? null : assertEmptyRoot(root);
  if (occupied) {
    console.error(`Refusing to scaffold: ${root} is not empty.`);
    console.error(`  found: ${occupied.slice(0, 8).join(', ')}${occupied.length > 8 ? ', …' : ''}`);
    console.error(
      '\nScaffolding overwrites generated files and is only safe in a fresh directory.\n' +
        'Use an empty directory, or pass --force if you are certain.',
    );
    return 1;
  }

  console.log(`Scaffolding into ${root}`);
  mkdirSync(root, { recursive: true });

  // `pre` files must exist before the first command — `npm install --workspaces`
  // cannot run without the root package.json that declares those workspaces.
  if (sp.pre.length) {
    const { created, replaced } = writeConventions(sp.pre, plan.vars);
    for (const p of created) console.log(`  + ${p}`);
    for (const p of replaced) console.log(`  ~ ${p}`);
  }

  const failedAt = runCommands(sp, Number(arg('from') ?? 0));
  if (failedAt) {
    console.error(
      `\nStopped at step ${failedAt}. Nothing after it ran, and no convention files were ` +
        `written.\nFix the cause, then resume with:  --from ${failedAt}`,
    );
    return 1;
  }

  const { created, replaced } = writeConventions(sp.post, plan.vars);
  console.log(`\nConvention files: ${created.length} created, ${replaced.length} replaced`);
  for (const p of created) console.log(`  + ${p}`);
  for (const p of replaced) console.log(`  ~ ${p} (replaced the generated default)`);

  if (writeEnvExample(sp)) console.log('  + .env.example');

  const builds = (plan.verify ?? []).map((v) => v.build).filter((b, i, a) => a.indexOf(b) === i);
  if (builds.length) {
    console.log(`\nScaffold complete. Verify with:  ${builds.join('  &&  ')}`);
  } else {
    console.log('\nScaffold complete.');
  }
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
