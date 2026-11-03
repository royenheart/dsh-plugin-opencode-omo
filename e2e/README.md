# @royenheart/dsh-plugin-opencode-omo — end-to-end suite

Self-contained Playwright project for the browser-visible surfaces of the
`opencode-omo` dsh plugin that the served release actually exposes:

- the global **opencode-omo → 角色设置** settings page;
- the complete 14-role omo catalog with each role's description and default
  model chain;
- the per-role primary-model selector (`跟随当前`, `使用 omo 默认`, or a fixed
  model) and its reasoning-effort selector;
- the fallback add panel (search, repeatable additions, duplicate rejection),
  cancel/outside/Escape dismissal, persistence, and chip removal.

On dsh `0.2.2-alpha.3` the host marks the `opencode-omo` agent preset
**Failed to load**: its composition still mounts the retired
`@deepseek-ai/dsh-tool-subagent-control/list-agents` export. The preset,
composer role picker, slash commands, and bundled skills are therefore not
reachable through the plugin's own UI on this release, so this suite records
the surfaces that do work.

## Run

```sh
npm install
DSH_MIGRATE_WEB_URL=... npx playwright test
```

The suite opens `DSH_MIGRATE_WEB_URL` and never starts `dsh`. The URL carries
the token that a browser exchanges for an authenticated session.

`index.json` maps each covered feature to its entry path, expected result, and
the spec that checks it.

## Step convention

Every test is split into top-level `test.step`s titled `reach:` or `check:`.
`reach:` steps own all host UI navigation (launch URL, preview notice,
workspace picker, settings dialog) and may fail when the host UI moves.
`check:` steps assert only what the plugin renders or does, plus a final
tripwire for console errors and page errors.
