# @royenheart/dsh-plugin-opencode-omo — end-to-end suite

Self-contained Playwright project for the browser-visible surfaces of the
`opencode-omo` dsh plugin that the served release actually exposes:

- the global **opencode-omo → 角色设置** settings page, its heading, intro and
  single selected tab;
- the complete 14-role omo catalog with each role's description and default
  model chain;
- the per-role primary-model selector (`跟随当前`, `使用 omo 默认`, or a fixed
  model), its menu-close behavior, and the reasoning-effort selector;
- the fallback add panel: search (case-insensitive), repeatable additions in
  insertion order, duplicate rejection, cancel/toggle/outside/Escape
  dismissal, per-role scoping, chip removal, and persistence across both
  Settings reopen and a full page reload.

On dsh `0.2.2-rc.1` the host still marks the `opencode-omo` agent preset
**Failed to load**: its composition still mounts the retired
`@deepseek-ai/dsh-tool-subagent-control/list-agents` export
(`tool-subagent-list-agents (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started`).
Because the preset cannot be selected, the composer role picker, the `/start-work`,
`/remove-ai-slops`, `/refactor`, `/stop-continuation`, `/handoff`, `/hyperplan`
and `/team-mode` commands, and the bundled `user-dsh` skills are not reachable
through the plugin's own UI on this release. This suite therefore records the
surfaces that do work; tests for the unreachable surfaces are not kept, because
they cannot pass.

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

## Specs

| Spec | Covers |
|---|---|
| `specs/role-settings.spec.ts` | Settings page, role catalog, primary model, reasoning effort, fallback add/search/cancel/remove/persistence |
| `specs/fallback-scope.spec.ts` | Fallback chains per role, insertion order, single-chip removal |
| `specs/persistence.spec.ts` | Pinned model + effort + fallback chip survive a full page reload |
