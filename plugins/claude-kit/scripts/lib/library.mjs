/** Loading and validating the fragment library. No rendering happens here. */

import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Is this module the entry point?
 *
 * The obvious `import.meta.url === \`file://${process.argv[1]}\`` is WRONG and
 * fails silently: import.meta.url resolves symlinks, process.argv[1] does not.
 * On macOS /tmp and /var are symlinks to /private/*, so any plugin installed
 * under such a path would run main() never, exit 0, and write no files — a
 * silent no-op, the worst possible failure mode. Compare real paths instead.
 */
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return real(fileURLToPath(importMetaUrl)) === real(process.argv[1]);
}

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LIBRARY_ROOT = join(PLUGIN_ROOT, 'library');
export const FRAGMENTS_ROOT = join(LIBRARY_ROOT, 'fragments');

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot parse ${p}: ${e.message}`);
  }
};

const dirs = (p) =>
  existsSync(p)
    ? readdirSync(p)
        .filter((n) => !n.startsWith('.') && statSync(join(p, n)).isDirectory())
        .sort()
    : [];

/**
 * Loads axes.json, slots.json and every fragment.json under library/fragments/.
 * Structural problems (missing dirs, id/path mismatch) throw here; semantic
 * problems (bad requires, unfilled slots) are the validator's and resolver's job.
 */
export function loadLibrary() {
  const axesDoc = readJson(join(LIBRARY_ROOT, 'axes.json'));
  const slotsDoc = readJson(join(LIBRARY_ROOT, 'slots.json'));

  const fragments = new Map(); // "axis/option" -> fragment (with _dir)
  for (const axis of dirs(FRAGMENTS_ROOT)) {
    for (const option of dirs(join(FRAGMENTS_ROOT, axis))) {
      const dir = join(FRAGMENTS_ROOT, axis, option);
      const manifest = join(dir, 'fragment.json');
      if (!existsSync(manifest)) {
        throw new Error(`Fragment ${axis}/${option} has no fragment.json`);
      }
      const frag = readJson(manifest);
      const id = `${axis}/${option}`;
      if (frag.id !== id) {
        throw new Error(`${manifest}: id "${frag.id}" does not match its path "${id}"`);
      }
      if (frag.axis !== axis) {
        throw new Error(`${manifest}: axis "${frag.axis}" does not match its path "${axis}"`);
      }
      frag._dir = dir;
      fragments.set(id, frag);
    }
  }

  const axes = axesDoc.axes.filter((a) => !a.id.startsWith('$'));

  // `$comment` is used throughout these manifests to carry design rationale,
  // including INSIDE the maps. Strip those keys once, here, so no consumer has
  // to remember that an entry might be documentation rather than a definition.
  const defs = (map) =>
    Object.fromEntries(Object.entries(map ?? {}).filter(([k]) => !k.startsWith('$')));

  // `shared` and `scripts` are optional and default to {} so a library that
  // predates them still loads — every consumer iterates, none indexes blindly.
  return {
    axes,
    slots: defs(slotsDoc.slots),
    shared: defs(slotsDoc.shared),
    scripts: defs(slotsDoc.scripts),
    agents: defs(slotsDoc.agents),
    fragments,
  };
}

export const fragmentOf = (lib, axisId, option) => lib.fragments.get(`${axisId}/${option}`);

export const axisById = (lib, id) => lib.axes.find((a) => a.id === id);

/**
 * Is `frag` selectable given the answers decided so far?
 * An unanswered axis cannot rule anything out — `requires` only constrains
 * axes that already have a value.
 */
export function isAvailable(frag, answers) {
  for (const [axisId, allowed] of Object.entries(frag.requires ?? {})) {
    const chosen = answers[axisId];
    if (chosen !== undefined && !allowed.includes(chosen)) return false;
  }
  return true;
}

/** Options of `axisId` still selectable given `answers`. */
export function availableOptions(lib, axisId, answers) {
  const axis = axisById(lib, axisId);
  if (!axis) throw new Error(`Unknown axis "${axisId}"`);
  return axis.options.filter((opt) => {
    const frag = fragmentOf(lib, axisId, opt);
    return frag ? isAvailable(frag, answers) : false;
  });
}

/**
 * Every axis value pinned by an already-selected fragment's `implies`.
 * Returns axisId -> { option, by } so the interview can report the choice
 * rather than asking for it.
 */
export function impliedAnswers(lib, answers) {
  const implied = {};
  for (const [axisId, option] of Object.entries(answers)) {
    const frag = fragmentOf(lib, axisId, option);
    for (const [target, value] of Object.entries(frag?.implies ?? {})) {
      implied[target] = { option: value, by: frag.id };
    }
  }
  return implied;
}

export { readJson };
