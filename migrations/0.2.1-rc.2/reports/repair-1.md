# DSH 0.2.1-rc.2 compatibility repair

## 1. Errors you addressed

The mechanical check reported 14 dependency-contract errors, all of the same form:

`peerDependencies: <package> is "^0.2.0-rc.1", which does not admit 0.2.1-rc.2`

The affected peers were:

- `@deepseek-ai/dsh-agent`
- `@deepseek-ai/dsh-api-session-controller`
- `@deepseek-ai/dsh-client-connection`
- `@deepseek-ai/dsh-client-ui-conversation`
- `@deepseek-ai/dsh-client-ui-primitives`
- `@deepseek-ai/dsh-client-ui-session`
- `@deepseek-ai/dsh-client-ui-settings`
- `@deepseek-ai/dsh-client-ui-slots`
- `@deepseek-ai/dsh-client-ui-renderer`
- `@deepseek-ai/dsh-llm`
- `@deepseek-ai/dsh-sandbox`
- `@deepseek-ai/dsh-session`
- `@deepseek-ai/dsh-settings`
- `@deepseek-ai/dsh-tools`

I changed every DSH peer range from `^0.2.0-rc.1` to `^0.2.1-rc.2`. The dependency contract now reports no findings against the actual npm registry for `0.2.1-rc.2`.

## 2. Root cause

The failure is a packaging-range error, not a plugin API or runtime failure.

Under npm's default semver rules, a prerelease version can satisfy a range only when a comparator in that range has the same `major.minor.patch` tuple and opts into a prerelease. The range `^0.2.0-rc.1` expands to `>=0.2.0-rc.1 <0.3.0`; its prerelease comparator is in the `0.2.0` tuple, so it excludes `0.2.1-rc.2`.

The dsh host's runtime compatibility check uses `includePrerelease: true` and would accept the old range, which is why the plugin could previously appear to work. The migration's mechanical dependency check uses npm's ordinary rules, so the declared install contract was invalid even though the host check was lenient.

Raising the peer floor to `^0.2.1-rc.2` makes the range's prerelease comparator share the target's tuple and admits the target under both npm's default rules and the host's prerelease-enabled check.

## 3. Files changed

- `package.json` — replaced all 14 `@deepseek-ai/dsh-*` peer ranges with `^0.2.1-rc.2`. No other manifest fields changed.
- `.dsh-migrate/runs/39267827157-1/cards.json` — updated the notes for `DSH-0.1.7-RC1-01` and `DSH-0.2.0-RC1-01` to record the new peer floor. This file is the migration ledger outside the plugin tree.

No source files, preset files, patch files, or tests were changed for this repair.

## 4. Why this should pass the next checks

- The exact check that failed, `checkDependencyContract(package.json, "0.2.1-rc.2", …)`, now returns no findings against the npm registry.
- Every DSH peer satisfies `0.2.1-rc.2` under both ordinary semver matching and `includePrerelease: true`, so the host boot compatibility gate also accepts the package.
- `npm run build` passes, including `tsc --noEmit` and the `tsdown` bundle build.
- `npm test` passes: 127 tests, 125 passed, 2 skipped. The two skips are the existing web end-to-end pair that requires a reachable host at `127.0.0.1:3080`; they are not failures.
- The card ledger still covers all 183 cards, with no required card open and evidence present for every completed card.
- The repair does not alter plugin runtime behavior, preset composition, or the existing assistant-prefill patch, so boot, web, and end-to-end behavior are unchanged.

## 5. What you did not change

- I did not change plugin source code, `cordis.patch.yml`, preset declarations, role prompts, driver behavior, or settings transport.
- I did not change `patches/0001-agent-pre-step-assistant-prefill.patch`; it remains the required dsh-side patch for the documented assistant-role `MAX_STEPS_PROMPT` continuation, and its existing patch report remains valid.
- I did not edit the end-to-end suite, its configuration, or its snapshots.
- I did not add or remove compiler/toolchain packages.
- I did not change the plugin version or product scope.
- I did not modify the harness checkout; it already contained the applied assistant-prefill patch.
- I did not commit, open issues, or open pull requests.