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
import { join, dirname, relative } from 'node:path';
import {
  loadLibrary,
  fragmentOf,
  axisById,
  isAvailable,
  impliedAnswers,
  readJson,
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
      github_user: project.github_user ?? '',
    },
  };
  for (const frag of selected) {
    // Namespaced by AXIS, not fragment id — so a template written for
    // orm/drizzle referencing <% orm.schema_dir %> lifts into orm/prisma.
    vars[frag.axis] = { ...(frag.vars ?? {}), _id: frag.id, _label: frag.label };
  }

  /* 4. Slot table: exactly one owner per emitted slot. -------------------- */

  const slots = [];
  const emittedNames = new Map();

  for (const [canonical, def] of Object.entries(lib.slots)) {
    const ownerOption = answers[def.owner_axis];
    if (ownerOption === undefined) continue;
    const owner = fragmentOf(lib, def.owner_axis, ownerOption);
    const bodyRel = owner.provides?.[canonical];
    if (!bodyRel) continue; // this option legitimately provides no such slot

    const emit = owner.emit_as?.[canonical] ?? canonical;
    if (emittedNames.has(emit)) {
      fail(
        `Slot name collision: "${emit}" is emitted by both ${emittedNames.get(emit)} and ` +
          `${owner.id} (canonical "${canonical}"). Fix emit_as in one of them.`,
      );
    }
    emittedNames.set(emit, owner.id);

    // Contributions from OTHER axes, in the declared contributor order.
    const anchors = {};
    const appends = [];
    const order = def.contributor_order ?? [];
    for (const axisId of order) {
      const contributor = answers[axisId] && fragmentOf(lib, axisId, answers[axisId]);
      if (!contributor || contributor.id === owner.id) continue;
      for (const [target, rel] of Object.entries(contributor.contributes ?? {})) {
        const [slotId, anchor] = target.split('#');
        if (slotId !== canonical) continue;
        const abs = join(contributor._dir, rel);
        if (anchor) anchors[anchor] = { file: abs, from: contributor.id };
        else appends.push({ file: abs, from: contributor.id });
      }
    }

    slots.push({
      canonical,
      emit,
      group: def.group,
      agent: def.agent,
      owner: owner.id,
      body: relative(PLUGIN_ROOT, join(owner._dir, bodyRel)),
      anchors: Object.fromEntries(
        Object.entries(anchors).map(([k, v]) => [k, { ...v, file: relative(PLUGIN_ROOT, v.file) }]),
      ),
      appends: appends.map((a) => ({ ...a, file: relative(PLUGIN_ROOT, a.file) })),
    });
  }

  slots.sort((a, b) => a.emit.localeCompare(b.emit));

  /* 5. Agents — frontmatter is DERIVED from the slot table, never authored. */

  const agents = [];
  for (const [name, def] of Object.entries(lib.agents ?? {})) {
    const gate = def.skip_when ?? {};
    const skipped = Object.entries(gate).some(([ax, vals]) => vals.includes(answers[ax]));
    const mine = slots.filter((s) => s.agent === name);
    if (skipped || mine.length === 0) continue;

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

    for (const req of ['description', 'impl_order']) {
      if (!merged[req]) fail(`${primary.id} must set agent.${name}.${req}`);
    }

    merged.skills = mine.map((s) => s.emit);
    agents.push({ name, template: def.template, vars: merged });
  }

  if (slots.length === 0) fail('These answers produce no skills at all — nothing to generate.');

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
    .map((f) => ({ from: f.id, build: f.verify.build }));

  /* 8. Derived rollups the templates read. ------------------------------- */

  // `backend` is the backend-framework namespace plus computed rollups, so
  // templates say <% backend.common_dir %> rather than the hyphenated axis id.
  vars.backend = {
    ...(vars['backend-framework'] ?? {}),
    build_cmd: verify[0]?.build ?? '',
    language: selected.map((f) => f.traits?.language).find(Boolean) ?? '',
  };
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

  return {
    version: 1,
    project: vars.project,
    answers,
    auto_selected: autoSelected,
    fragments: selected.map((f) => f.id),
    vars,
    slots,
    agents,
    claude_md: claudeMd,
    hooks,
    settings: { enabledPlugins },
    verify,
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

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
