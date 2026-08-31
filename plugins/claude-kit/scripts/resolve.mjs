#!/usr/bin/env node
/**
 * resolve.mjs — answers.json + library -> plan.json
 *
 * This is where correctness lives. Everything downstream (render.mjs) assumes a
 * plan is already valid, so every compatibility rule, slot-ownership check and
 * variable merge happens here and nowhere else.
 *
 *   node scripts/resolve.mjs --answers <path> [--out <path>]
 *   node scripts/resolve.mjs --answers <path> --quiet     # validate only
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { render } from './lib/erb.mjs';
import { join, dirname, relative } from 'node:path';
import {
  loadLibrary,
  fragmentOf,
  axisById,
  isAvailable,
  impliedAnswers,
  readJson,
  isMainModule,
  PLUGIN_ROOT,
} from './lib/library.mjs';

/* --------------------------------------------------------------- helpers */

const pascal = (s) =>
  s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');

const slug = (s) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

class ResolveError extends Error {}
const fail = (msg) => {
  throw new ResolveError(msg);
};

/* --------------------------------------------------------------- resolve */

export function resolvePlan(answersDoc) {
  const lib = loadLibrary();
  const answers = { ...answersDoc.answers };
  const project = answersDoc.project ?? {};

  if (!project.name) fail('answers.json: project.name is required');

  /* 1. Apply `implies`, then validate every answer against its axis. ------ */

  const implied = impliedAnswers(lib, answers);
  const autoSelected = {};
  for (const [axisId, { option, by }] of Object.entries(implied)) {
    if (answers[axisId] === undefined) {
      answers[axisId] = option;
      autoSelected[axisId] = by;
    } else if (answers[axisId] !== option) {
      fail(
        `Axis "${axisId}" is answered "${answers[axisId]}" but ${by} implies "${option}". ` +
          `Remove the answer, or pick a different ${by.split('/')[0]}.`,
      );
    }
  }

  for (const axis of lib.axes) {
    const chosen = answers[axis.id];
    if (chosen === undefined) {
      if (axis.required) fail(`Axis "${axis.id}" is required but was not answered`);
      continue;
    }
    if (!axis.options.includes(chosen)) {
      fail(`Axis "${axis.id}": "${chosen}" is not one of ${axis.options.join(', ')}`);
    }
    if (!fragmentOf(lib, axis.id, chosen)) {
      fail(`Axis "${axis.id}": no fragment exists at library/fragments/${axis.id}/${chosen}/`);
    }
  }

  for (const key of Object.keys(answers)) {
    if (!axisById(lib, key)) fail(`answers.json: "${key}" is not a known axis`);
  }

  /* 2. Compatibility: requires + conflicts across the selected set. ------- */

  const selected = lib.axes
    .filter((a) => answers[a.id] !== undefined)
    .map((a) => fragmentOf(lib, a.id, answers[a.id]));
  const selectedIds = new Set(selected.map((f) => f.id));

  for (const frag of selected) {
    if (!isAvailable(frag, answers)) {
      const unmet = Object.entries(frag.requires)
        .filter(([ax, ok]) => answers[ax] !== undefined && !ok.includes(answers[ax]))
        .map(([ax, ok]) => `${ax} must be one of [${ok.join(', ')}], got "${answers[ax]}"`);
      fail(`${frag.id} is not compatible with these answers — ${unmet.join('; ')}`);
    }
    for (const other of frag.conflicts ?? []) {
      if (selectedIds.has(other)) fail(`${frag.id} conflicts with ${other}`);
    }
  }

  /* 3. Variable namespaces. ---------------------------------------------- */

  const vars = {
    project: {
      name: project.name,
      slug: project.slug ?? slug(project.name),
      pascal: project.pascal ?? pascal(project.name),
      description: project.description ?? `${project.name} project`,
      notification_title: project.notification_title ?? project.name,
      repo: project.repo ?? '',
      // Only ever interpolated into documentation — pr.sh and /ship read the
      // real login from `gh api user` at runtime. Left empty it renders a
      // branch convention as "/<slug>", which reads like a broken path rather
      // than a placeholder, so an unanswered value says so out loud.
      github_user: project.github_user || '<github-user>',
      // The loop needs these four. They were never asked for before because
      // nothing consumed them; pr.sh, plan-state.sh and the artifact hook all
      // do now, and every one of them is wrong-by-default if guessed.
      base_branch: project.base_branch ?? 'main',
      worktree_root:
        project.worktree_root ?? `~/repos/${project.slug ?? slug(project.name)}-worktrees`,
      plans_dir: project.plans_dir ?? 'docs/plans',
      qa_dir: project.qa_dir ?? 'docs/qa',
    },
  };
  for (const frag of selected) {
    // Namespaced by AXIS, not fragment id — so a template written for
    // orm/drizzle referencing <% orm.schema_dir %> lifts into orm/prisma.
    vars[frag.axis] = { ...(frag.vars ?? {}), _id: frag.id, _label: frag.label };
  }

  /* 4. Slot table: exactly one owner per emitted slot. -------------------- */

  /**
   * Contributions from OTHER axes, in the declared contributor order.
   *
   * Shared by all four kinds of emitted file — axis-owned slots, base-owned
   * slots, shared includes and scripts. They differ only in where the BODY
   * comes from, never in how contributions compose, so this stays one function.
   */
  const gather = (canonical, def, ownerId) => {
    const anchors = {};
    const appends = [];
    for (const axisId of def.contributor_order ?? []) {
      const contributor = answers[axisId] && fragmentOf(lib, axisId, answers[axisId]);
      if (!contributor || contributor.id === ownerId) continue;
      for (const [target, rel] of Object.entries(contributor.contributes ?? {})) {
        const [slotId, anchor] = target.split('#');
        if (slotId !== canonical) continue;
        const file = relative(PLUGIN_ROOT, join(contributor._dir, rel));
        if (anchor) anchors[anchor] = { file, from: contributor.id };
        else appends.push({ file, from: contributor.id });
      }
    }
    return { anchors, appends };
  };

  /**
   * A base-owned file is dropped when any gate axis holds a listed value —
   * the same shape agents already use. It is what makes `manual-qa` disappear
   * along with the frontend rather than shipping a QA skill with nothing to
   * click, without inventing a second conditional mechanism.
   */
  const skipped = (def) =>
    Object.entries(def.skip_when ?? {}).some(([ax, vals]) => vals.includes(answers[ax]));

  /** Base template paths are library-relative; slot bodies are plugin-relative. */
  const baseBody = (rel) => join('library', rel);

  const slots = [];
  const emittedNames = new Map();

  for (const [canonical, def] of Object.entries(lib.slots)) {
    let ownerId, emit, body;

    if (def.owner === 'base') {
      // Owned by no axis: always emitted unless gated. Axes only contribute.
      if (skipped(def)) continue;
      ownerId = 'base';
      emit = canonical;
      body = baseBody(def.body);
    } else {
      const ownerOption = answers[def.owner_axis];
      if (ownerOption === undefined) continue;
      const owner = fragmentOf(lib, def.owner_axis, ownerOption);
      const bodyRel = owner.provides?.[canonical];
      if (!bodyRel) continue; // this option legitimately provides no such slot
      ownerId = owner.id;
      emit = owner.emit_as?.[canonical] ?? canonical;
      body = relative(PLUGIN_ROOT, join(owner._dir, bodyRel));
    }

    if (emittedNames.has(emit)) {
      fail(
        `Slot name collision: "${emit}" is emitted by both ${emittedNames.get(emit)} and ` +
          `${ownerId} (canonical "${canonical}"). Fix emit_as in one of them.`,
      );
    }
    emittedNames.set(emit, ownerId);

    const { anchors, appends } = gather(canonical, def, ownerId);

    slots.push({
      canonical,
      emit,
      group: def.group,
      agent: def.agent ?? null,
      owner: ownerId,
      body,
      anchors,
      appends,
    });
  }

  slots.sort((a, b) => a.emit.localeCompare(b.emit));

  /* 4b. Shared includes and scripts. --------------------------------------
   *
   * Neither is a skill: `skills/shared/*.md` has no frontmatter and is never
   * invoked — the skills that need it are told to read it — and `scripts/*.sh`
   * is executed rather than read. Both still take contributed anchors, because
   * a generic gate script and a generic review pipeline both have
   * stack-specific things to say inside them.
   */
  const baseFiles = (map) =>
    Object.entries(map ?? {})
      .filter(([, def]) => !skipped(def))
      .map(([name, def]) => ({ name, body: baseBody(def.body), ...gather(name, def, 'base') }))
      .sort((a, b) => a.name.localeCompare(b.name));

  const shared = baseFiles(lib.shared);
  const scripts = baseFiles(lib.scripts);

  /* 5. Agents — frontmatter is DERIVED from the slot table, never authored. */

  const agents = [];
  for (const [name, def] of Object.entries(lib.agents ?? {})) {
    const gate = def.skip_when ?? {};
    const skipped = Object.entries(gate).some(([ax, vals]) => vals.includes(answers[ax]));
    const mine = slots.filter((s) => s.agent === name);
    // An agent normally exists to carry a group of skills, so owning none means
    // the answers dropped its whole area and it should go too. `no_skills`
    // marks the exception: an agent whose instructions live entirely in its own
    // body and a shared discipline file, with no skill group of its own.
    if (skipped || (mine.length === 0 && !def.no_skills)) continue;

    const primaryAxis = def.required_axis;
    const primary = fragmentOf(lib, primaryAxis, answers[primaryAxis]);
    const merged = { context: [], rules: [] };

    for (const frag of selected) {
      const c = frag.agent?.[name];
      if (!c) continue;
      for (const [k, v] of Object.entries(c)) {
        if (Array.isArray(v)) {
          merged[k] = [...(merged[k] ?? []), ...v];
        } else if (frag.id === primary.id) {
          merged[k] = v;
        } else {
          fail(
            `${frag.id} sets agent.${name}.${k}, but only the primary axis ` +
              `"${primaryAxis}" may set scalar agent fields. Use an array field instead.`,
          );
        }
      }
    }

    // Only the fields this agent's template actually reads. Demanding
    // `impl_order` of an agent that never implements anything would be a
    // required field with nothing to put in it.
    for (const req of def.requires_vars ?? ['description', 'impl_order']) {
      if (!merged[req]) fail(`${primary.id} must set agent.${name}.${req}`);
    }

    merged.skills = mine.map((s) => s.emit);
    agents.push({ name, template: def.template, vars: merged });
  }

  // Workflow slots are base-owned and always present, so a bare `slots.length`
  // check can no longer notice that the STACK produced nothing. Ask the
  // question that actually matters: did any axis contribute a skill?
  if (!slots.some((s) => s.owner !== 'base')) {
    fail('These answers produce no stack skills at all — nothing to generate.');
  }

  /* 6. CLAUDE.md sections — same anchor mechanism as composite slots. ---- */

  const claudeMd = {};
  for (const frag of selected) {
    for (const [target, rel] of Object.entries(frag.contributes ?? {})) {
      const [doc, anchor] = target.split('#');
      if (doc !== 'claude-md' || !anchor) continue;
      (claudeMd[anchor] ??= []).push({
        file: relative(PLUGIN_ROOT, join(frag._dir, rel)),
        from: frag.id,
      });
    }
  }

  /* 7. Hooks, settings, verify. ------------------------------------------ */

  const hooks = {};
  for (const frag of selected) {
    for (const [hook, rules] of Object.entries(frag.hooks ?? {})) {
      (hooks[hook] ??= []).push(...rules.map((r) => ({ ...r, from: frag.id })));
    }
  }

  const enabledPlugins = [
    ...new Set(selected.flatMap((f) => f.settings?.enabledPlugins ?? [])),
  ].sort();

  const verify = selected
    .filter((f) => f.verify?.build)
    .map((f) => ({ from: f.id, axis: f.axis, build: f.verify.build }));

  /* 7a. verify.sh steps and no-retry causes. ------------------------------
   *
   * `build` above is a single command an agent template quotes. These are the
   * real gate: every step the generated verify.sh runs, tagged with the area
   * that owns it so the script can run areas concurrently and scope them to
   * whatever actually changed.
   *
   * `causes` are failure classes the loop must NOT hand to an agent, because
   * "fixing" them damages correct code — a stale generated client, a wire
   * contract shipped consumers depend on, a stopped Docker daemon. Each
   * fragment declares its own; most declare none.
   */
  const verifySteps = [];
  const verifyCauses = [];
  const verifyErrPatterns = [];
  const verifyWarns = [];
  for (const frag of selected) {
    for (const step of frag.verify?.steps ?? []) {
      verifySteps.push({ ...step, area: step.area ?? frag.verify.area, from: frag.id });
    }
    for (const cause of frag.verify?.causes ?? []) {
      verifyCauses.push({ ...cause, from: frag.id });
    }
    for (const pat of frag.verify?.err_patterns ?? []) verifyErrPatterns.push(pat);
    for (const w of frag.verify?.warns ?? []) {
      verifyWarns.push({ ...w, has_missing: Boolean(w.missing), missing: w.missing ?? '', from: frag.id });
    }
  }
  verifySteps.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  /* 7b. Scaffold — the commands that create the application itself. -------
   *
   * `selected` is in lib.axes order, which IS the required execution order:
   * backend-framework (`dotnet new sln`) must precede orm (`dotnet add
   * package`) must precede mapping (`dotnet add package`). That ordering is a
   * consequence of the interview order, so there is deliberately no dependency
   * graph here — if a fragment ever needs to run out of axis order, fix the
   * axis order rather than inventing a scheduler.
   */

  const scaffold = { requires: [], commands: [], conventions: [], env: {} };
  for (const frag of selected) {
    for (const [tool, min] of Object.entries(frag.scaffold?.requires ?? {})) {
      scaffold.requires.push({ tool, min, from: frag.id });
    }
    for (const cmd of frag.scaffold?.commands ?? []) {
      scaffold.commands.push({ ...cmd, from: frag.id });
    }
    for (const conv of frag.scaffold?.conventions ?? []) {
      scaffold.conventions.push({
        from: relative(PLUGIN_ROOT, join(frag._dir, conv.from)),
        to: conv.to,
        phase: conv.phase ?? 'post',
        fragment: frag.id,
      });
    }
    Object.assign(scaffold.env, frag.scaffold?.env ?? {});
  }

  /* 8. Derived rollups the templates read. ------------------------------- */

  // `backend`/`frontend` are the framework namespaces plus computed rollups, so
  // templates say <% backend.common_dir %> rather than the hyphenated axis id.
  //
  // build_cmd is keyed by the OWNING axis, never by position. Taking verify[0]
  // would hand the backend agent the frontend's build command as soon as a
  // frontend fragment declares one.
  const buildFor = (axisId) => verify.find((v) => v.axis === axisId)?.build ?? '';

  const hasFrontend =
    answers['frontend-framework'] !== undefined && answers['frontend-framework'] !== 'none';

  vars.backend = {
    ...(vars['backend-framework'] ?? {}),
    build_cmd: buildFor('backend-framework'),
    language: selected
      .filter((f) => f.axis === 'backend-framework' || f.axis === 'orm')
      .map((f) => f.traits?.language)
      .find(Boolean) ?? '',
  };
  vars.frontend = {
    ...(vars['frontend-framework'] ?? {}),
    build_cmd: buildFor('frontend-framework'),
    language: 'typescript',
    // An explicit boolean, because `<% unless frontend.something %>` on a var
    // that does not exist is falsey and therefore ALWAYS renders — the failure
    // mode is a section that silently appears in every project.
    enabled: hasFrontend,
  };
  /* The areas fan-out.
   *
   * Nearly everything in the loop is a repetition over this list: the plan
   * file's task headings, the per-side attempt counters, verify.sh's
   * concurrent legs and scope detection, verify-change's path -> agent routing
   * table, self-check's fix sections, implement-plan's dispatch order. Deriving
   * it once means a future mobile axis appends one entry here and the whole
   * loop fans out to it, instead of every workflow template growing a third
   * hardcoded branch.
   *
   * `tests` is an area rather than a tier because it has its own owning agent:
   * the implementer must never write the tests that judge its own work.
   */
  // `match` is an ERE, not a path prefix, because the two are not
  // interchangeable: NestJS keeps its unit specs co-located inside the backend
  // app directory, so "which area is this file" cannot be answered by a prefix
  // alone. Areas may legitimately overlap — a changed spec belongs to `tests`
  // for routing and still requires the backend leg to compile.
  const area = (id, label, agentName, match) => ({
    id,
    label,
    agent: agentName,
    match,
    attempts: `verify.${id}Attempts`,
  });

  vars.areas = [
    area('backend', 'Backend', 'backend-developer', vars.backend.app_dir ? `^${vars.backend.app_dir}/` : ''),
    area('tests', 'Tests', 'backend-tester', vars.backend.test_match ?? ''),
    ...(hasFrontend
      ? [area('frontend', 'Frontend', 'frontend-developer', vars.frontend.app_dir ? `^${vars.frontend.app_dir}/` : '')]
      : []),
  ].filter((a) => a.match);

  /* verify.sh's view of the same data.
   *
   * Tiers are declared per step as an explicit list rather than a threshold,
   * because they are NOT cumulative: `tests` runs the suite without the
   * frontend legs, for the test writer's inner loop. A threshold would have to
   * encode that exception in bash; a list states it in the fragment.
   *
   * `run_sh` is the single-quote-escaped form, because each step is invoked as
   * `bash -c '<run>'` and a fragment command legitimately contains quotes.
   */
  const shq = (cmd) => String(cmd).replace(/'/g, `'\\''`);
  const legAreas = [...new Set(verifySteps.map((s) => s.area).filter(Boolean))];

  vars.verify = {
    steps: verifySteps.map((s) => ({
      ...s,
      tiers_csv: (s.tiers ?? []).join(' '),
      run_sh: shq(s.run),
    })),
    causes: verifyCauses.map((c) => ({ ...c, patterns_csv: (c.patterns ?? []).join('|') })),
    legs: legAreas.map((id) => ({
      id,
      // The tests leg runs alone, after the others: test runners already fan
      // out across cores, so running suites concurrently oversubscribes the
      // machine and finishes slower while interleaving their output.
      is_tests: id === 'tests',
      steps: verifySteps
        .filter((s) => s.area === id)
        .map((s) => ({ ...s, tiers_csv: (s.tiers ?? []).join(' '), run_sh: shq(s.run) })),
    })),
    warns: verifyWarns,
    tiers: ['quick', 'tests', 'full', 'integration'],
    // The union of what every selected stack calls an error. Greping a failing
    // step's own log with this is what keeps a green run's build output out of
    // the caller's context entirely, and a red run's report down to the lines
    // that actually name the cause.
    err_re: [...new Set(verifyErrPatterns)].join('|') || 'error|ERROR|FAIL|failed',
  };

  // Templates read `agent.<short>`. The `-developer` pair drop that suffix for
  // readability (`agent.backend`); every other agent keeps its full name
  // (`agent.backend-tester`), because stripping a role suffix generally would
  // collide backend-developer and backend-tester onto the same key.
  vars.agent = Object.fromEntries(
    agents.map((a) => [a.name.replace(/-developer$/, ''), a.vars]),
  );
  vars.skills = {
    all: slots.map((s) => s.emit),
    by_group: [...new Set(slots.map((s) => s.group))].map((group) => ({
      group,
      items: slots.filter((s) => s.group === group).map((s) => ({ name: s.emit })),
    })),
  };
  vars.agents = {
    all: agents.map((a) => ({
      name: a.name,
      summary: a.vars.description,
      skills: a.vars.skills,
    })),
  };
  // Key Rules and the post-compact reminder are the same content at two
  // altitudes, so both read one list rather than drifting apart.
  vars.rules = { all: selected.flatMap((f) => f.vars?.claude_rules ?? []) };
  vars.settings = { enabledPlugins };

  // What is actually enforced mechanically, derived from the hook rules rather
  // than restated. safety-invariants.md prints this as its "what enforces what"
  // table: the single most drift-prone paragraph in both source repos was the
  // one claiming a rule was guarded when the guard had been renamed or removed.
  vars.hooks = {
    all: Object.entries(hooks)
      .filter(([, rules]) => rules.length)
      .map(([name, rules]) => ({
        name,
        rules: rules.map((r) => ({ ...r, message: r.message ?? '' })),
      })),
  };

  /* 9. Expand variables that themselves interpolate other variables. ------ */
  //
  // A .NET fragment's src_dir is genuinely "src/<% project.pascal %>.Api", and
  // an agent context line references "<% backend.src_dir %>". Both are var
  // VALUES, which no template pass would otherwise render — the tag would
  // survive into the output and only the render backstop would catch it.
  //
  // Runs last, over the whole tree, so a var may reference any namespace
  // regardless of the order things were built. Repeats until stable because a
  // value may expand into another reference; three passes is far more than any
  // real chain and bounds a cycle.
  const expandTree = (node, where, scope) => {
    if (typeof node === 'string') return render(node, scope, where, { allowResidual: true });
    if (Array.isArray(node)) return node.map((v, i) => expandTree(v, `${where}[${i}]`, scope));
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [k, expandTree(v, `${where}.${k}`, scope)]),
      );
    }
    return node;
  };

  let expanded = vars;
  for (let pass = 0; pass < 3; pass++) {
    const next = expandTree(expanded, 'vars', expanded);
    if (JSON.stringify(next) === JSON.stringify(expanded)) break;
    expanded = next;
  }
  if (JSON.stringify(expandTree(expanded, 'vars', expanded)) !== JSON.stringify(expanded)) {
    fail('Variable expansion did not converge — a var likely references itself.');
  }
  Object.assign(vars, expanded);
  // agents[].vars is the same data the template reads via vars.agent.*
  for (const agent of agents) {
    agent.vars = vars.agent[agent.name.replace(/-developer$/, '')];
  }

  /* 10. Expand the shell-facing strings. ---------------------------------
   *
   * Scaffold commands and destinations are var VALUES too ("dotnet new sln
   * --name <% project.pascal %>"), so they need the same treatment. STRICT
   * here — no allowResidual — because an unresolved tag that reaches a shell
   * is a mangled `dotnet` invocation, and a half-scaffolded directory is much
   * worse to recover from than a resolve-time error.
   */
  for (const cmd of scaffold.commands) {
    cmd.run = render(cmd.run, vars, `${cmd.from} scaffold.run`);
    if (cmd.cwd) cmd.cwd = render(cmd.cwd, vars, `${cmd.from} scaffold.cwd`);
  }
  for (const conv of scaffold.conventions) {
    conv.to = render(conv.to, vars, `${conv.fragment} scaffold.to`);
  }
  for (const [key, value] of Object.entries(scaffold.env)) {
    scaffold.env[key] = render(value, vars, `scaffold.env.${key}`);
  }
  for (const v of verify) {
    v.build = render(v.build, vars, `${v.from} verify.build`);
  }

  return {
    version: 1,
    project: vars.project,
    answers,
    auto_selected: autoSelected,
    fragments: selected.map((f) => f.id),
    vars,
    slots,
    shared,
    scripts,
    agents,
    claude_md: claudeMd,
    hooks,
    settings: { enabledPlugins },
    scaffold,
    verify,
    verify_steps: verifySteps,
    verify_causes: verifyCauses,
  };
}

/* ------------------------------------------------------------------- cli */

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const answersPath = arg('answers');
  if (!answersPath) {
    console.error('usage: resolve.mjs --answers <path> [--out <path>] [--quiet]');
    return 2;
  }

  let plan;
  try {
    plan = resolvePlan(readJson(answersPath));
  } catch (e) {
    console.error(e instanceof ResolveError ? `resolve: ${e.message}` : e.stack);
    return 1;
  }

  const out = arg('out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(plan, null, 2) + '\n');
  }

  if (!argv.includes('--quiet')) {
    const auto = Object.entries(plan.auto_selected);
    console.log(`project   ${plan.project.name} (${plan.project.slug})`);
    console.log(`fragments ${plan.fragments.join(', ')}`);
    if (auto.length) {
      console.log(`auto      ${auto.map(([a, by]) => `${a} <- ${by}`).join(', ')}`);
    }
    console.log(`skills    ${plan.slots.map((s) => s.emit).join(', ')}`);
    console.log(`agents    ${plan.agents.map((a) => a.name).join(', ') || '(none)'}`);
    if (out) console.log(`wrote     ${out}`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
