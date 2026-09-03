# Upgrade to DeepSeek Harness 0.1.2-alpha.5 — blocked

**Status:** blocked upstream. Do not bump this repo's `@deepseek-ai/dsh-*` peers until resolved.
**Opened:** 2026-09-02

## Context

The other DSH-consuming repos in this project were updated from `0.1.1-rc.2` to `0.1.2-alpha.5`:

- `dsh-plugin-codegraph`
- `dsh-lsp-actions`
- `harness-development/omo-plugin`

This repo (`dsh-plugin-opencode-omo`) was intentionally left on `0.1.1-rc.2` for all
`@deepseek-ai/dsh-*` peers/devDependencies.

## Blocker

`@deepseek-ai/dsh-client-runtime` — a required peer of this plugin — has no `0.1.2-alpha.x`
release on the npm registry. Its latest published version is `0.1.1-rc.2`:

```
$ npm view @deepseek-ai/dsh-client-runtime versions --json
[
  "0.0.1-rc.1", "0.0.1-rc.2", "0.0.1-rc.3", "0.0.1-rc.5",
  "0.1.0-rc.2", "0.1.0-rc.3", "0.1.0-rc.6", "0.1.0-rc.7", "0.1.0-rc.8",
  "0.1.1-rc.1", "0.1.1-rc.2"
]
```

Every other `dsh-client-*` peer this plugin depends on **does** have a `0.1.2-alpha.5` build
(`dsh-client-connection`, `dsh-client-ui-conversation`, `dsh-client-ui-primitives`,
`dsh-client-ui-settings`, `dsh-client-ui-settings-general`, `dsh-client-ui-slots`,
`dsh-host-webserver`, `dsh-settings`, `dsh-agent`, `dsh-llm`, `dsh-sandbox`).
`dsh-client-runtime` is the one holdout.

## Why we're not forcing it

Bumping every peer except `dsh-client-runtime` would put the plugin in a mixed
`0.1.1-rc.2` / `0.1.2-alpha.5` dependency state. The upstream `deepseek-ai/deepseek-harness`
v0.1.2-alpha.5 release notes explicitly call out that exact class of upgrade as broken:

> Fix an issue where upgrading from `0.1.1-rc.2` or `0.1.2-alpha.3` could prevent the app
> from starting or make session titles disappear from the list.

Since alpha releases carry no compatibility guarantees, shipping a partial bump here is a
reasonable way to reproduce that class of bug, not avoid it.

## Options

1. **Wait for upstream** to publish a matching `dsh-client-runtime` 0.1.2-alpha.x release,
   then re-run the same peer bump used in the other three repos.
2. **Force the partial bump** (bump everything except `dsh-client-runtime`) as a known-risk
   temporary state — not recommended given the release-notes warning above.
3. **Ask upstream directly** (`deepseek-ai/deepseek-harness`) whether `dsh-client-runtime`
   was intentionally deprecated, merged into another package, or simply missed in the alpha
   line — this would change which of the above is correct.

## Unblock checklist

- [ ] Re-run `npm view @deepseek-ai/dsh-client-runtime versions --json` and confirm a
      `0.1.2-alpha.x` (or later stable) version now exists.
- [ ] If yes: bump `@deepseek-ai/cordis` to `^4.0.2` and all `@deepseek-ai/dsh-*` peers/dev
      deps in `package.json` to the matching version, mirroring the diffs already applied in
      `dsh-plugin-codegraph`, `dsh-lsp-actions`, and `harness-development/omo-plugin`.
      Add `@deepseek-ai/dsh-client-runtime` to that same version.
      Grep `src/` for renamed/removed APIs before assuming a clean bump — the 0.1.2 alpha
      line already renamed `CallId` to `ToolCallId` in `dsh-llm` and replaced `Session.events`
      with `seq()` / `eventAt()` / `snapshotEvents()`.
- [ ] `pnpm install`, `tsc --noEmit`, `npm test` all green before merging.
