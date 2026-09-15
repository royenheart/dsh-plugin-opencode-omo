# opencode-omo end-to-end lane

Playwright + Chromium against a real `dsh web` instance that this plugin is
installed into. The lane is keyless and deterministic: no provider credential is
forwarded, no test waits on network idle, and no assertion reads a host-owned
`data-*` attribute.

## What it covers

| spec | surface | asserts |
|---|---|---|
| `specs/preset-mode-picker.spec.ts` | web-client | the `opencode-omo` entry in the hero mode picker, preset roster health, and that other presets keep their default composer chrome |
| `specs/role-picker.spec.ts` | web-client | the composer role chip, the primary-role menu, per-session role persistence, and a pinned role model reaching the session model control |
| `specs/settings-section.spec.ts` | web-client | the global `opencode-omo` settings section, its nested `角色设置` tab, and the full role catalog rows |
| `specs/settings-role-models.spec.ts` | web-client | primary-model dropdown, the "+" fallback panel (repeat adds, duplicate refusal, cancel/Escape/outside), durability across reload, and the `opencode-omo-roles` settings document |
| `specs/settings-geometry.spec.ts` | web-client | box invariants: panel/chip list below the role box, full row width, no overlap, no horizontal overflow, 28px circular "+" |
| `specs/preset-commands.spec.ts` | web-client | the omo slash-command and skill catalogs in the composer trigger menu, and their absence outside the preset |
| `specs/settings-rpc-fallback.spec.ts` | web-client | the authenticated `/opencode-omo` channel memory-mode browsers fall back to (**known failure**, pinned) |
| `specs/bundle-composition.spec.ts` | cli | `dsh --profile web --dump-config` composes the bundle row; the install links the package and publishes the preset through `$DSH_HOME/.agent-presets` |
| `specs/agent-runtime-surfaces.spec.ts` | headless | skipped ledger of model-visible surfaces that need a live provider (see the file comments) |

The coverage ledger (feature → spec → state) is the `index.json` written beside
this directory in the migration staging output. When this lane is merged, keep a
copy of that ledger with the suite (for example `e2e/features.json`) so the
feature-to-spec mapping travels with the code; the `test` paths in it are already
repository-relative.

## Prerequisites

The lane needs a built plugin (`lib/index.js`, `lib/client.js`) and a harness
checkout. Add these devDependencies to the repository root (or install them
where the fixture can resolve them):

```sh
npm install --save-dev \
  @playwright/test@^1.61.1 \
  @deepseek-ai/dsh@0.1.6-alpha.1 \
  @deepseek-ai/dsh-lsp@0.1.6-alpha.1 \
  @deepseek-ai/dsh-lsp-stdio@0.1.6-alpha.1 \
  @deepseek-ai/dsh-tool-lsp@0.1.6-alpha.1
npx playwright install chromium
npm run build
```

The three `dsh-lsp*` packages are not part of `@deepseek-ai/dsh`; the preset's
LSP rows resolve them from the profile module tree, and without them the roster
reports **Failed to load** and the mode never reaches the picker. The fixture
links them into the isolated profile and fails with the exact missing package
when they are absent.

## Run

```sh
npx playwright test --config e2e/playwright.config.ts          # whole lane
npx playwright test --config e2e/playwright.config.ts -g role  # one area
```

Environment overrides:

| variable | meaning |
|---|---|
| `DSH_E2E_DSH_BIN` | dsh executable to boot (default: `<repo>/node_modules/.bin/dsh`, then `dsh` on `PATH`) |
| `DSH_E2E_LSP_ROOT` | node_modules tree carrying `@deepseek-ai/dsh-lsp*` (default: `<repo>/node_modules`) |

Each worker creates a temp `$DSH_HOME` plus a temp workspace, installs the
package, publishes the preset, boots `dsh web` on an OS-assigned loopback port,
logs in with the printed launch token, and removes both temp roots on teardown.
Nothing is written into the plugin checkout; failure traces/screenshots go to
`.artifacts/playwright` (add `.artifacts/` to `.gitignore`).

## Known failure

`specs/settings-rpc-fallback.spec.ts` is pinned with `test.fail()`: on dsh
0.1.6-alpha.1 the plugin never mounts its authenticated `/opencode-omo` channel
because `connection.rpc.handle()` reads `owner.webServer` while the plugin's
context does not inject `webServer`. Loopback browsers use the settings scope
and are unaffected, so the UI lane passes; a non-loopback browser would lose
role settings. When the channel is fixed the test fails as "passed
unexpectedly" — promote it and the ledger row to `passing`.
