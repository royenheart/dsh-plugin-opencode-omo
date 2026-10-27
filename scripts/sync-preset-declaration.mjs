#!/usr/bin/env node
/**
 * Regenerate the bundle patch from the preset's composition file.
 *
 * The 0.2.1 `@deepseek-ai/dsh-agent-preset` row takes an inline `plugins:`
 * entry list. Keeping a second hand-edited copy would drift, so the bundle
 * patch embeds `presets/opencode-omo/agent.cordis.yml` verbatim (indented) and
 * `tests/preset-declaration.spec.mjs` fails when it does not.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, ROOT), 'utf8')

const metadata = Object.fromEntries(read('presets/opencode-omo/preset.yml')
  .split('\n')
  .map(line => line.match(/^([A-Za-z][\w-]*):\s*(.*)$/))
  .filter(Boolean)
  .map(match => [match[1], match[2]]))

const composition = read('presets/opencode-omo/agent.cordis.yml').replace(/\s+$/, '')
const indented = composition.split('\n').map(line => line === '' ? '' : `          ${line}`).join('\n')

const text = `# Bundle patch for @royenheart/dsh-plugin-opencode-omo.
#
# The package's own host row owns the volatile \`opencode-omo\` settings entry
# (role/session maps) and the \`ctx.omoRoles\` service. The \`opencode-omo\`
# agent preset is declared with the official @deepseek-ai/dsh-agent-preset row;
# its plugin list is generated from presets/opencode-omo/agent.cordis.yml.
#
# Run \`node scripts/sync-preset-declaration.mjs\` after editing the composition;
# tests/preset-declaration.spec.mjs fails when the embedded list drifts.
- insert:
    - id: opencode-omo
      name: '@royenheart/dsh-plugin-opencode-omo'
- insert:
    - id: preset-opencode-omo
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: opencode-omo
        name: ${JSON.stringify(metadata.name ?? 'opencode-omo')}
        description: ${JSON.stringify(metadata.description ?? '')}
        order: ${metadata.order ?? '5'}
        plugins:
${indented}
`

writeFileSync(new URL('cordis.patch.yml', ROOT), text)
