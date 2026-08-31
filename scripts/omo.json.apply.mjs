#!/usr/bin/env node
/**
 * omo.json.apply.mjs — import an omo.json defaults file into a running
 * DeepSeek Harness host through the opencode-omo plugin's import endpoint.
 *
 * Usage:
 *   node scripts/omo.json.apply.mjs [path] [--host http://127.0.0.1:3080]
 *
 * Defaults: path = ~/.omo/omo.json, host = http://127.0.0.1:3080.
 * The host-side endpoint reads the file itself, so the script only forwards
 * the path (no secrets or file contents leave the host process boundary).
 *
 * Exit code 0 when the import ran (partial per-role errors included in the
 * output), non-zero on transport/config errors.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const IMPORT_PATH = '/plugins/@royenheart/dsh-plugin-opencode-omo/omo-json/import'

function usage() {
  console.error('usage: node scripts/omo.json.apply.mjs [path] [--host http://127.0.0.1:3080]')
  process.exit(2)
}

const args = process.argv.slice(2)
let path = '~/.omo/omo.json'
let host = 'http://127.0.0.1:3080'
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--host') {
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) usage()
    host = value.replace(/\/+$/, '')
    index += 1
  } else if (arg.startsWith('-')) {
    usage()
  } else {
    path = arg
  }
}

const expanded = path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
console.log(`omo.json.apply: importing ${expanded} into ${host}`)

try {
  const response = await fetch(`${host}${IMPORT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: expanded }),
  })
  const result = await response.json()
  if (!response.ok) {
    console.error(`omo.json.apply: HTTP ${response.status} ${JSON.stringify(result)}`)
    process.exit(1)
  }
  console.log(`omo.json.apply: ok=${String(result.ok)} imported=${result.imported}`)
  for (const error of result.errors ?? []) {
    console.log(`  - ${error}`)
  }
  process.exit(result.ok ? 0 : 1)
} catch (error) {
  console.error(`omo.json.apply: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
