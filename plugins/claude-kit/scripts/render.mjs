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

  /* Composition --------------------------------------------------------- */
  //
  // Anchors render first — a contributed section may itself reference vars —
  // then feed the owner body as scalars under the `sections` namespace. Skills,
  // shared includes and scripts all compose identically; only the destination
  // path and the file mode differ.
  const compose = (entry) => {
    const sections = {};
    for (const [anchor, src] of Object.entries(entry.anchors ?? {})) {
      sections[anchor] = render(readTpl(src.file), v, src.file).trimEnd();
    }

    let body = render(readTpl(entry.body), { ...v, sections }, entry.body);
    for (const app of entry.appends ?? []) {
      body = body.trimEnd() + '\n\n' + render(readTpl(app.file), v, app.file).trimEnd() + '\n';
    }
    return body;
  };

  /* Skills ------------------------------------------------------------- */
  for (const slot of plan.slots) {
    put(`skills/${slot.emit}/SKILL.md`, compose(slot));
  }

  /* Shared includes ------------------------------------------------------ */
  // Not skills: no frontmatter, no SKILL.md wrapper, never invoked. The skills
  // that depend on them are told to read them by path, which is exactly why
  // there is one copy instead of one per caller.
  for (const inc of plan.shared ?? []) {
    put(`skills/shared/${inc.name}.md`, compose(inc));
  }

  /* Scripts -------------------------------------------------------------- */
  // Executable, because every caller invokes them by path. Both source repos
  // made chmod a manual setup step and both documented forgetting it.
  for (const script of plan.scripts ?? []) {
    put(`scripts/${script.name}`, compose(script), 0o755);
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
  put('README.md', render(readBase('base/README.md.tmpl'), v, 'base/README.md.tmpl'));

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

  // Base hooks take no fragment rules — they are the same guard in every
  // project, parameterised only by paths — so they are emitted unconditionally
  // rather than through the rule loop above.
  for (const name of ['post-compact-reminder', 'protect-plan-artifacts', 'test-protect-plan-artifacts']) {
    const tpl = `base/hooks/${name}.sh.tmpl`;
    put(`hooks/${name}.sh`, render(readBase(tpl), v, tpl), 0o755);
    activeHooks.push(name);
  }

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
  // Bash, not Edit|Write: this one inspects the command line, because staging
  // an artifact and running destructive git are things you do with git, not
  // with the file tools.
  pre.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command: '.claude/hooks/protect-plan-artifacts.sh' }],
  });

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
  // Zero-token progress: which task, which stage, how many attempts in. The
  // loop runs one stage per invocation, so without this the only way to see
  // where a run is up to is to open the state file.
  settings.statusLine = { type: 'command', command: '.claude/scripts/statusline.sh' };
  settings.hooks.SessionStart = [
    {
      matcher: 'compact',
      hooks: [{ type: 'command', command: '.claude/hooks/post-compact-reminder.sh' }],
    },
  ];
  put('settings.json', JSON.stringify(settings, null, 2));

  // The allowlist an unattended run needs, as an EXAMPLE rather than a live
  // settings.local.json. Granting a loop the right to run commands without
  // asking should be an explicit human act, and this file is never read by
  // Claude Code until someone renames it.
  //
  // Two absences are deliberate: bare `git push` and `gh pr create`. pr.sh is
  // the single choke point for both and only ever opens drafts; granting the
  // underlying commands hands that guarantee away for nothing.
  const allow = [
    'Bash(.claude/scripts/verify.sh:*)',
    'Bash(.claude/scripts/plan-state.sh:*)',
    'Bash(.claude/scripts/pr.sh:*)',
    'Bash(.claude/scripts/statusline.sh)',
    'Bash(.claude/hooks/test-protect-plan-artifacts.sh)',
    'Bash(git status:*)',
    'Bash(git diff:*)',
    'Bash(git log:*)',
    'Bash(git branch:*)',
    'Bash(git rev-parse:*)',
    'Bash(git merge-base:*)',
    'Bash(git fetch:*)',
    'Bash(git worktree:*)',
    'Bash(git add:*)',
    'Bash(git commit:*)',
    // Only the refspec form /pr-self-check uses. The hook still blocks the
    // force and base-branch forms, so this stays narrow on both sides.
    'Bash(git push origin HEAD:*)',
    'Bash(gh pr view:*)',
    'Bash(gh pr diff:*)',
    'Bash(gh pr checks:*)',
    'Bash(gh api user:*)',
    'Bash(jq:*)',
  ];
  if (plan.vars.frontend.enabled) allow.push('Bash(.claude/scripts/qa-env.sh:*)');

  put(
    'settings.local.example.json',
    JSON.stringify(
      {
        $comment:
          'Copy to settings.local.json to let an unattended /ship run proceed without a ' +
          'permission prompt per command. Read every line first — this is the file that ' +
          'decides what the loop may do while nobody is watching.',
        permissions: { allow },
      },
      null,
      2,
    ),
  );

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
