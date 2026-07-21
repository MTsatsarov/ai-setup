/** Unit checks for the template engine. No framework — this runs on plain node. */

import { render, referencedPaths } from '../scripts/lib/erb.mjs';

let failed = 0;
const eq = (label, actual, expected) => {
  if (actual === expected) return;
  console.error(`  FAIL ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  failed = 1;
};
const throws = (label, fn) => {
  try {
    fn();
    console.error(`  FAIL ${label} — expected a throw, got none`);
    failed = 1;
  } catch {
    /* expected */
  }
};

const data = {
  project: { name: 'demo' },
  orm: { schema_dir: 'src/db', soft_delete: 'column', empty: '', list: [] },
  agent: { skills: ['a', 'b', 'c'] },
  groups: [{ group: 'Backend', items: [{ name: 'x' }, { name: 'y' }] }],
};

eq('scalar', render('<% project.name %>', data), 'demo');
eq('nested scalar', render('<% orm.schema_dir %>', data), 'src/db');
eq('each + last', render('<% each agent.skills %><% . %><% unless @last %>,<% end %><% end %>', data), 'a,b,c');
eq('each + index', render('<% each agent.skills %><% @index %><% end %>', data), '012');
eq('each + first', render('<% each agent.skills %><% if @first %>[<% end %><% . %><% end %>', data), '[abc');
eq('if taken', render('<% if orm.soft_delete %>Y<% end %>', data), 'Y');
eq('if missing path is falsey', render('<% if orm.absent %>Y<% end %>N', data), 'N');
eq('unless missing path', render('<% unless orm.absent %>Y<% end %>', data), 'Y');
eq('empty string is falsey', render('<% if orm.empty %>Y<% end %>N', data), 'N');
eq('empty list is falsey', render('<% if orm.list %>Y<% end %>N', data), 'N');
eq('nested each with field access', render('<% each groups %><% .group %>:<% each .items %><% .name %><% end %><% end %>', data), 'Backend:xy');

// The delimiter choice is load-bearing: these must survive untouched, because
// real skill bodies contain i18next and Angular interpolation.
eq('leaves {{ }} alone', render('t("{{name}}") and {{ item.name }}', data), 't("{{name}}") and {{ item.name }}');
eq('leaves ${ } alone', render('${HOME} and `${x}`', data), '${HOME} and `${x}`');
eq('leaves [[ ]] alone', render('if [[ "$A" == b ]]; then', data), 'if [[ "$A" == b ]]; then');

throws('undefined scalar', () => render('<% project.nope %>', data));
throws('undefined namespace', () => render('<% nope.x %>', data));
throws('unclosed block', () => render('<% if project.name %>x', data));
throws('stray end', () => render('x<% end %>', data));
throws('list as scalar', () => render('<% agent.skills %>', data));
throws('each over a scalar', () => render('<% each project.name %>x<% end %>', data));
throws('loop meta outside each', () => render('<% @index %>', data));
throws('malformed tag', () => render('<% if %>x<% end %>', data));

eq('referencedPaths', referencedPaths('<% project.name %><% each agent.skills %><% . %><% end %>').join(','), 'project.name,agent.skills');

if (failed) {
  console.error('erb: FAILED');
  process.exit(1);
}
console.log('erb: 24 assertions passed');
