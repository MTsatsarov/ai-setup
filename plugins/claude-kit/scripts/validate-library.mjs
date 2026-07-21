#!/usr/bin/env node
/**
 * validate-library.mjs — everything that can be checked without a target repo.
 *
 * Tier 1  structural: manifests, cross-references, files on disk
 * Tier 2  combinatorial: resolve AND render every legal axis combination
 *
 * Tier 2 is the one that earns its keep. It is what catches "you added
 * ui-kit/vue but nothing provides frontend-crud-listing for it" at the moment
 * the fragment is authored rather than the first time someone picks it.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadLibrary, axisById, isAvailable, PLUGIN_ROOT } from './lib/library.mjs';
import { resolvePlan } from './resolve.mjs';
import { buildPayload } from './render.mjs';

const problems = [];
const err = (msg) => problems.push(msg);

/* ------------------------------------------------------- tier 1: structure */

function checkStructure(lib) {
  const axisIds = new Set(lib.axes.map((a) => a.id));

  for (const axis of lib.axes) {
    if (!axis.options?.length) err(`axes.json: axis "${axis.id}" has no options`);
    if (!axis.header || axis.header.length > 12) {
      err(`axes.json: axis "${axis.id}" header must be 1-12 chars (AskUserQuestion limit)`);
    }
    for (const opt of axis.options ?? []) {
      if (!lib.fragments.has(`${axis.id}/${opt}`)) {
        err(`axes.json: "${axis.id}" lists option "${opt}" but library/fragments/${axis.id}/${opt}/ does not exist`);
      }
    }
  }

  for (const [id, frag] of lib.fragments) {
    const axis = axisById(lib, frag.axis);
    if (!axis) {
      err(`${id}: axis "${frag.axis}" is not declared in axes.json`);
    } else if (!axis.options.includes(id.split('/')[1])) {
      err(`${id}: exists on disk but is not listed in axes.json options for "${frag.axis}"`);
    }
    if (!frag.label) err(`${id}: missing "label" (shown in the interview)`);

    for (const [ax, opts] of Object.entries(frag.requires ?? {})) {
      if (!axisIds.has(ax)) err(`${id}: requires unknown axis "${ax}"`);
      for (const o of opts) {
        if (axisIds.has(ax) && !axisById(lib, ax).options.includes(o)) {
          err(`${id}: requires ${ax}="${o}" which is not an option of that axis`);
        }
      }
    }
    for (const [ax, opt] of Object.entries(frag.implies ?? {})) {
      if (!axisIds.has(ax)) err(`${id}: implies unknown axis "${ax}"`);
      else if (!axisById(lib, ax).options.includes(opt)) {
        err(`${id}: implies ${ax}="${opt}" which is not an option of that axis`);
      }
    }

    const referenced = [
      ...Object.entries(frag.provides ?? {}),
      ...Object.entries(frag.contributes ?? {}),
    ];
    for (const [key, rel] of referenced) {
      if (!existsSync(join(frag._dir, rel))) {
        err(`${id}: "${key}" points at ${rel}, which does not exist`);
      }
    }
    // Scaffold sources are not covered by the provides/contributes loop above,
    // so a typo'd convention path would otherwise ship silently and only fail
    // mid-scaffold, with a half-built project already on disk.
    for (const conv of frag.scaffold?.conventions ?? []) {
      if (!existsSync(join(frag._dir, conv.from))) {
        err(`${id}: scaffold convention points at ${conv.from}, which does not exist`);
      }
      if (conv.phase !== undefined && conv.phase !== 'pre' && conv.phase !== 'post') {
        err(`${id}: scaffold convention "${conv.to}" has phase "${conv.phase}" — use "pre" or "post"`);
      }
    }
    for (const cmd of frag.scaffold?.commands ?? []) {
      if (!cmd.run?.trim()) err(`${id}: scaffold command has an empty "run"`);
    }

    for (const slot of Object.keys(frag.provides ?? {})) {
      if (!lib.slots[slot]) err(`${id}: provides unknown slot "${slot}"`);
      else if (lib.slots[slot].owner_axis !== frag.axis) {
        err(`${id}: provides "${slot}", but that slot is owned by axis "${lib.slots[slot].owner_axis}"`);
      }
    }
    for (const slot of Object.keys(frag.emit_as ?? {})) {
      if (!frag.provides?.[slot]) err(`${id}: emit_as names "${slot}" which it does not provide`);
    }
    for (const target of Object.keys(frag.contributes ?? {})) {
      const [doc] = target.split('#');
      if (doc === 'claude-md') continue;
      if (!lib.slots[doc]) err(`${id}: contributes to unknown slot "${doc}"`);
      else if (lib.slots[doc].owner_axis === frag.axis) {
        err(`${id}: contributes to "${doc}" which it already owns — put the content in the body`);
      }
    }
  }

  for (const [slot, def] of Object.entries(lib.slots)) {
    if (!axisIds.has(def.owner_axis)) {
      err(`slots.json: "${slot}" owner_axis "${def.owner_axis}" is not a declared axis`);
    }
    for (const ax of def.contributor_order ?? []) {
      if (!axisIds.has(ax)) err(`slots.json: "${slot}" contributor_order names unknown axis "${ax}"`);
    }
    const providers = [...lib.fragments.values()].filter((f) => f.provides?.[slot]);
    if (!providers.length) err(`slots.json: no fragment provides "${slot}" — the slot is dead`);
  }

  for (const [name, def] of Object.entries(lib.agents ?? {})) {
    if (!existsSync(join(PLUGIN_ROOT, 'library', def.template))) {
      err(`slots.json: agent "${name}" template ${def.template} does not exist`);
    }
    if (!axisIds.has(def.required_axis)) {
      err(`slots.json: agent "${name}" required_axis "${def.required_axis}" is not a declared axis`);
    }
  }
}

/* --------------------------------------------------- tier 2: combinatorial */

/** Every answer set that satisfies the declared requires/implies constraints. */
function legalCombinations(lib) {
  const out = [];
  const walk = (i, answers) => {
    if (i === lib.axes.length) {
      out.push({ ...answers });
      return;
    }
    const axis = lib.axes[i];
    for (const opt of axis.options) {
      const frag = lib.fragments.get(`${axis.id}/${opt}`);
      if (!frag || !isAvailable(frag, answers)) continue;
      // An `implies` that contradicts an earlier answer is pruned here rather
      // than surfacing as a resolve error for a combination nobody can pick.
      const conflicting = Object.entries(frag.implies ?? {}).some(
        ([ax, val]) => answers[ax] !== undefined && answers[ax] !== val,
      );
      if (conflicting) continue;
      walk(i + 1, { ...answers, [axis.id]: opt });
    }
  };
  walk(0, {});
  return out;
}

function checkCombinations(lib) {
  const combos = legalCombinations(lib);
  if (!combos.length) {
    err('No legal axis combination exists — requires/implies rules are contradictory');
    return 0;
  }

  for (const answers of combos) {
    const label = Object.entries(answers)
      .map(([a, o]) => `${a}=${o}`)
      .join(' ');
    try {
      const plan = resolvePlan({
        project: { name: 'Validation Probe' },
        answers,
      });
      for (const agent of plan.agents) {
        for (const skill of agent.vars.skills) {
          if (!plan.slots.some((s) => s.emit === skill)) {
            err(`[${label}] agent ${agent.name} lists skill "${skill}" with no provider`);
          }
        }
      }
      buildPayload(plan); // renders every template with real values
    } catch (e) {
      err(`[${label}] ${e.message}`);
    }
  }
  return combos.length;
}

/* ------------------------------------------------------------------- main */

function main() {
  let lib;
  try {
    lib = loadLibrary();
  } catch (e) {
    console.error(`library: ${e.message}`);
    return 1;
  }

  checkStructure(lib);
  const combos = problems.length ? 0 : checkCombinations(lib);

  if (problems.length) {
    console.error(`FAIL — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  • ${p}`);
    return 1;
  }

  console.log(
    `OK — ${lib.axes.length} axes, ${lib.fragments.size} fragments, ` +
      `${Object.keys(lib.slots).length} slots, ${combos} legal combinations resolved and rendered`,
  );
  return 0;
}

process.exit(main());
