# @royenheart/dsh-plugin-opencode-omo — end-to-end suite

Self-contained Playwright project for the browser-visible surfaces of the
`opencode-omo` dsh plugin:

- the `opencode-omo` agent preset in the new-session mode menu;
- the composer role picker and the omo primary/all role menu;
- the global **opencode-omo → 角色设置** settings page, including primary model,
  reasoning effort, and fallback add/search/cancel/remove flows;
- the seven omo slash commands and the skills shipped with the preset.

## Run

```sh
npm install
DSH_MIGRATE_WEB_URL=... npx playwright test
```

The suite opens `DSH_MIGRATE_WEB_URL` and never starts `dsh`. The URL carries
the token that a browser exchanges for an authenticated session.

`index.json` maps each user-visible feature to its entry path, expected result,
and the spec that checks it.

## Step convention

Every test is split into top-level `test.step`s titled `reach:` or `check:`.
`reach:` steps own all host UI navigation (launch URL, preview notice,
workspace picker, settings dialog, menus, composer) and may fail when the host
UI moves. `check:` steps assert only what the plugin renders or does, plus a
final tripwire for console errors and page errors.
