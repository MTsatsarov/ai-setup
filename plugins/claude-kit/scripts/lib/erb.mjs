/**
 * Minimal ERB-style template engine for claude-kit.
 *
 * Delimiters are `<% ... %>` rather than `{{ ... }}` because fragment bodies
 * legitimately contain `{{name}}` (i18next interpolation) and `{{ item.name }}`
 * (Angular templates). `${...}` collides with shell and JS template literals;
 * `[[ ]]` collides with bash tests inside the generated hook scripts.
 *
 * Grammar — exactly four forms, nothing else:
 *
 *   <% project.name %>                       scalar interpolation
 *   <% if orm.soft_delete %> … <% end %>     truthiness block
 *   <% unless auth.none %> … <% end %>       negated truthiness block
 *   <% each agent.skills %> … <% end %>      iteration
 *
 * Inside `each`:  <% . %> current item, <% .field %> field of current item,
 *                 <% @index %> <% @first %> <% @last %>
 *
 * There are deliberately no partials and no expressions. Composition happens
 * one level up, in compose.mjs, at the section level where it is inspectable.
 *
 * Unresolvable paths THROW rather than rendering empty — a silent empty string
 * is how a generator quietly produces a broken skill file.
 */

const TAG = /<%\s*([\s\S]*?)\s*%>/g;

/* ---------------------------------------------------------------- tokenize */

function tokenize(src) {
  const tokens = [];
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    if (m.index > last) tokens.push({ type: 'text', value: src.slice(last, m.index) });
    tokens.push({ type: 'tag', value: m[1], offset: m.index });
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push({ type: 'text', value: src.slice(last) });
  return tokens;
}

/* ------------------------------------------------------------------- parse */

function parse(tokens, origin) {
  const root = { type: 'root', body: [] };
  const stack = [root];

  for (const tok of tokens) {
    const top = stack[stack.length - 1];

    if (tok.type === 'text') {
      top.body.push(tok);
      continue;
    }

    const tag = tok.value;
    const block = /^(if|unless|each)\s+(\S+)$/.exec(tag);

    if (block) {
      const node = { type: block[1], path: block[2], body: [] };
      top.body.push(node);
      stack.push(node);
    } else if (tag === 'end') {
      if (stack.length === 1) {
        throw new Error(`${origin}: unmatched <% end %>`);
      }
      stack.pop();
    } else if (/^(if|unless|each)\b/.test(tag)) {
      throw new Error(`${origin}: malformed block tag <% ${tag} %> — expected "<% each path %>"`);
    } else {
      if (/\s/.test(tag)) {
        throw new Error(`${origin}: malformed tag <% ${tag} %> — interpolation takes a single path`);
      }
      top.body.push({ type: 'interp', path: tag });
    }
  }

  if (stack.length !== 1) {
    const open = stack[stack.length - 1];
    throw new Error(`${origin}: unclosed <% ${open.type} ${open.path} %> — missing <% end %>`);
  }
  return root;
}

/* ---------------------------------------------------------------- resolve */

function resolvePath(path, scopes, origin) {
  // Loop metadata
  if (path.startsWith('@')) {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].meta && path in scopes[i].meta) return scopes[i].meta[path];
    }
    throw new Error(`${origin}: <% ${path} %> used outside an <% each %> block`);
  }

  // Current item, or a field of it
  if (path === '.' || path.startsWith('.')) {
    const scope = [...scopes].reverse().find((s) => 'item' in s);
    if (!scope) {
      throw new Error(`${origin}: <% ${path} %> used outside an <% each %> block`);
    }
    if (path === '.') return scope.item;
    return walk(scope.item, path.slice(1).split('.'), path, origin);
  }

  return walk(scopes[0].data, path.split('.'), path, origin);
}

function walk(root, parts, path, origin) {
  let cur = root;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(part in cur)) {
      throw new Error(
        `${origin}: <% ${path} %> is not defined — no fragment on that axis provides it`,
      );
    }
    cur = cur[part];
  }
  return cur;
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}

/* ------------------------------------------------------------------ render */

function evaluate(node, scopes, origin, out) {
  for (const child of node.body) {
    switch (child.type) {
      case 'text':
        out.push(child.value);
        break;

      case 'interp': {
        const v = resolvePath(child.path, scopes, origin);
        if (v === null || v === undefined) {
          throw new Error(`${origin}: <% ${child.path} %> resolved to null`);
        }
        if (typeof v === 'object') {
          throw new Error(
            `${origin}: <% ${child.path} %> is a ${Array.isArray(v) ? 'list' : 'map'}, not a scalar — use <% each %>`,
          );
        }
        out.push(String(v));
        break;
      }

      case 'if':
      case 'unless': {
        // A missing path is falsey for conditionals; that is the whole point of
        // `unless`, and demanding every optional flag be declared everywhere
        // would make fragments depend on axes they know nothing about.
        let v;
        try {
          v = resolvePath(child.path, scopes, origin);
        } catch {
          v = undefined;
        }
        const take = child.type === 'if' ? truthy(v) : !truthy(v);
        if (take) evaluate(child, scopes, origin, out);
        break;
      }

      case 'each': {
        const list = resolvePath(child.path, scopes, origin);
        if (!Array.isArray(list)) {
          throw new Error(`${origin}: <% each ${child.path} %> — value is not a list`);
        }
        list.forEach((item, i) => {
          scopes.push({
            item,
            meta: { '@index': i, '@first': i === 0, '@last': i === list.length - 1 },
          });
          evaluate(child, scopes, origin, out);
          scopes.pop();
        });
        break;
      }
    }
  }
}

/**
 * @param {string}  src     template source
 * @param {object}  data    root variable namespace
 * @param {string}  origin  file path, used in error messages
 * @param {object} [opts]
 * @param {boolean} [opts.allowResidual]  skip the surviving-tag backstop. Only
 *   for the variable-expansion passes in resolve.mjs, where an intermediate
 *   result legitimately still holds a tag that a later pass will resolve.
 *   Never set it when rendering a file that is about to be written.
 * @returns {string}
 */
export function render(src, data, origin = '<template>', opts = {}) {
  const ast = parse(tokenize(src), origin);
  const out = [];
  evaluate(ast, [{ data }], origin, out);
  const result = out.join('');

  // Backstop: a var whose *value* contained a tag would slip past the parser.
  if (!opts.allowResidual && result.includes('<%')) {
    const stray = /<%[\s\S]{0,40}/.exec(result)[0].replace(/\n[\s\S]*/, '');
    throw new Error(`${origin}: unrendered template tag survived in output near "${stray}"`);
  }
  return result;
}

/** Every path referenced by a template, for the library validator. */
export function referencedPaths(src, origin = '<template>') {
  const paths = new Set();
  const visit = (node) => {
    for (const child of node.body) {
      if (child.type === 'interp') paths.add(child.path);
      else if (child.body) {
        paths.add(child.path);
        visit(child);
      }
    }
  };
  visit(parse(tokenize(src), origin));
  return [...paths].filter((p) => p && !p.startsWith('@') && !p.startsWith('.'));
}
