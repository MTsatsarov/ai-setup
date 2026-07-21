#!/usr/bin/env node
/**
 * render.mjs — plan.json -> a complete .claude/ payload
 *
 * Assumes the plan is already valid; resolve.mjs owns every compatibility rule.
 * This file only turns a resolved plan into bytes on disk.
 *
 *   node scripts/render.mjs --plan <path> --out <dir>
 *   node scripts/render.mjs --plan <path> --dry-run
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { render } from './lib/erb.mjs';
import { PLUGIN_ROOT, LIBRARY_ROOT, readJson, isMainModule } from './lib/library.mjs';

const readTpl = (rel) => readFileSync(join(PLUGIN_ROOT, rel), 'utf8');
const readBase = (rel) => readFileSync(join(LIBRARY_ROOT, rel), 'utf8');

/** Trim trailing blank lines, guarantee exactly one closing newline. */
const tidy = (s) => s.replace(/\s+$/, '') + '\n';

/* ------------------------------------------------------------------ build */

/**
 * Produces the full file set as an in-memory map (path -> {content, mode}).
 * Nothing touches disk here, which is what makes --dry-run and the golden
 * tests exact rather than approximate.
 */
export function buildPayload(plan) {
  const files = new Map();
  const put = (path, content, mode = 0o644) => files.set(path, { content: tidy(content), mode });
  const v = plan.vars;

  /* Skills ------------------------------------------------------------- */
  for (const slot of plan.slots) {
    // Anchors render first — a contributed section may itself reference vars —
    // then feed the owner body as scalars under the `sections` namespace.
    const sections = {};
    for (const [anchor, src] of Object.entries(slot.anchors ?? {})) {
      sections[anchor] = render(readTpl(src.file), v, src.file).trimEnd();
    }

    let body = render(readTpl(slot.body), { ...v, sections }, slot.body);
    for (const app of slot.appends ?? []) {
      body = body.trimEnd() + '\n\n' + render(readTpl(app.file), v, app.file).trimEnd() + '\n';
    }
    put(`skills/${slot.emit}/SKILL.md`, body);
  }

  /* Agents -------------------------------------------------------------- */
  for (const agent of plan.agents) {
    put(`agents/${agent.name}.md`, render(readBase(agent.template), v, agent.template));
  }

  /* CLAUDE.md ----------------------------------------------------------- */
  const claudeSections = {};
  for (const [anchor, srcs] of Object.entries(plan.claude_md ?? {})) {
    claudeSections[anchor] = srcs
      .map((s) => render(readTpl(s.file), v, s.file).trimEnd())
      .join('\n');
  }
  put(
    'CLAUDE.md',
    render(readBase('base/CLAUDE.md.tmpl'), { ...v, sections: claudeSections }, 'base/CLAUDE.md.tmpl'),
  );

  /* Hooks --------------------------------------------------------------- */
  const activeHooks = [];
  for (const [name, rules] of Object.entries(plan.hooks ?? {})) {
    if (!rules.length) continue; // a hook with no rules is dead weight
    const tplPath = `base/hooks/${name}.sh.tmpl`;
    const scope = {
      ...v,
      hook: {
        rules: rules.map((r) => ({
          ...r,
          message: render(r.message, v, `${name} rule from ${r.from}`),
          has_ext: Boolean(r.ext),
          ext: r.ext ?? '',
        })),
      },
    };
    put(`hooks/${name}.sh`, render(readBase(tplPath), scope, `base/${tplPath}`), 0o755);
    activeHooks.push(name);
  }

  const reminder = render(readBase('base/hooks/post-compact-reminder.sh.tmpl'), v, 'base/hooks/post-compact-reminder.sh.tmpl');
  put('hooks/post-compact-reminder.sh', reminder, 0o755);
  activeHooks.push('post-compact-reminder');

  /* settings.json ------------------------------------------------------- */
  // Built as an object rather than a template: JSON with <% each %> loops is a
  // comma-placement bug waiting to happen, and this has to be byte-valid.
  const pre = [];
  if (activeHooks.includes('protect-generated-files')) {
    pre.push({
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: '.claude/hooks/protect-generated-files.sh' }],
    });
  }
  if (activeHooks.includes('protect-migrations')) {
    pre.push({
      matcher: 'Edit',
      hooks: [{ type: 'command', command: '.claude/hooks/protect-migrations.sh' }],
    });
  }

  const settings = {};
  if (plan.settings.enabledPlugins.length) {
    settings.enabledPlugins = Object.fromEntries(
      plan.settings.enabledPlugins.map((p) => [p, true]),
    );
  }
  settings.hooks = {};
  if (pre.length) settings.hooks.PreToolUse = pre;
  settings.hooks.Notification = [
    {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: `osascript -e 'display notification "Claude Code needs your attention" with title "${plan.project.notification_title}"'`,
        },
      ],
    },
  ];
  settings.hooks.SessionStart = [
    {
      matcher: 'compact',
      hooks: [{ type: 'command', command: '.claude/hooks/post-compact-reminder.sh' }],
    },
  ];
  put('settings.json', JSON.stringify(settings, null, 2));

  return files;
}

/* ------------------------------------------------------------------- cli */

function main(argv) {
  const arg = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const planPath = arg('plan');
  const outDir = arg('out');
  const dryRun = argv.includes('--dry-run');

  if (!planPath || (!outDir && !dryRun)) {
    console.error('usage: render.mjs --plan <path> (--out <dir> | --dry-run)');
    return 2;
  }

  let files;
  try {
    files = buildPayload(readJson(planPath));
  } catch (e) {
    console.error(`render: ${e.message}`);
    return 1;
  }

  const paths = [...files.keys()].sort();

  if (dryRun) {
    for (const p of paths) {
      const { content, mode } = files.get(p);
      const sha = createHash('sha256').update(content).digest('hex').slice(0, 12);
      console.log(`${sha}\t${String(content.length).padStart(6)}\t${mode.toString(8)}\t${p}`);
    }
    return 0;
  }

  // Only ever replaces the generated tree; a sibling settings.local.json or any
  // hand-added file outside .claude/ is never in scope.
  if (existsSync(outDir) && argv.includes('--clean')) {
    rmSync(outDir, { recursive: true, force: true });
  }

  for (const p of paths) {
    const { content, mode } = files.get(p);
    const dest = join(outDir, p);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    chmodSync(dest, mode); // hooks ship executable; both source repos made this a manual step
  }

  console.log(`rendered ${paths.length} files to ${outDir}`);
  for (const p of paths) console.log(`  ${p}`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
