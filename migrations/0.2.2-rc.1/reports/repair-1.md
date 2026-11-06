## 1. Errors you addressed

The failing mechanical check reported 15 dependency-contract errors, all the same shape:

- 13 `peerDependencies` entries such as `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-tools`, and the client UI packages declared `^0.2.1-rc.2` and therefore did not admit `0.2.2-rc.1`.
- 2 `devDependencies` entries, `@deepseek-ai/dsh-client-ui-renderer` and `@deepseek-ai/dsh-sandbox`, had the same problem.

All 15 were updated to `^0.2.2-rc.1`. The active baseline metadata, README baseline table, patch target, and lockfile were promoted with them.

## 2. Root cause

The review's runtime migration (conditional tool registration, scoped restrictions, and the step-owned tool set) had already been applied to the working tree, but the **support claim was never promoted**. `package.json`, `alignment.json`, the README table, and `package-lock.json` still described `0.2.1-rc.2` as the active release.

Under npm/semver prerelease rules, `^0.2.1-rc.2` expands to `>=0.2.1-rc.2 <0.3.0`, and a prerelease such as `0.2.2-rc.1` only matches a comparator with the same `major.minor.patch` tuple. Therefore the range was refused even though `0.2.2-rc.1` is newer. The plugin's `scripts/check-alignment.mjs` also requires every DSH peer to equal the active target or `^target`, so merely widening the range would have left the repository internally inconsistent.

The correct fix was to promote the single active combination to `0.2.2-rc.1` and update everything that is required to agree with it, rather than claim support for both releases.

## 3. Files changed

- `package.json` — all 15 DSH-scoped peer/dev ranges changed from `^0.2.1-rc.2` to `^0.2.2-rc.1`.
- `package-lock.json` — regenerated against the `0.2.2-rc.1` package cohort; all `@deepseek-ai/dsh-*` entries now resolve to `0.2.2-rc.1` (and `@deepseek-ai/cordis` to the `4.1.x` line required by that release). No dependency was added.
- `alignment.json` — active `dsh.target` is `0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`.
- `README.md` — baseline table, “Required dsh-side changes”, fallback-host wording, conditional-tool note, and remaining-gaps wording now describe `0.2.2-rc.1` as the active release and one patch target.
- `patches/README.md` — one active patch targeting `dsh-v0.2.2-rc.1` (`66491b0`); notes that the retired `0.2.1-rc.2` variant is no longer shipped.
- `patches/0001-agent-pre-step-assistant-prefill-0.2.1-rc.2.patch` — removed, because `0.2.1-rc.2` is no longer the declared baseline. The required `0.2.2-rc.1` patch is retained.
- `design.md` — version references updated from `0.2.1-rc.2` to `0.2.2-rc.1`.
- `install.py` — docstring version reference updated.
- `.dsh-migrate/patch-reports/agent-pre-step-assistant-prefill/report.md` — records that the single active patch variant now targets `0.2.2-rc.1`; keeps the existing upstream [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407) link.

The working tree also still contains the review's already-applied source port (`driver.mjs`, `tool-surface.mjs`, `tool-policy.mjs`, `delegation-surface.mjs`, `escalating-bash.mjs`, `lsp-surface.mjs`, `tests/tool-admission.spec.mjs`, and related documentation). I left that implementation intact and validated it; it was not rewritten for this failure.

## 4. Why this should pass the next checks

The exact failing check was re-run through the migrator's own `runMechanical` entry point with `dshVersion: '0.2.2-rc.1'`:

- `ok=true`, `checks=3` (build, typecheck, and tests all ran and passed).
- A direct call to `checkDependencyContract` and `checkSourceImports` returned `[]`.
- `node scripts/check-alignment.mjs` passes for the promoted active combination.
- `node scripts/check-architecture.mjs` passes.
- `npm ci` from the regenerated lockfile succeeds.
- `npm run build` passes, including `tsc --noEmit` and the client bundle build.
- `npm test` passes with **150 passed, 1 skipped** (the live-web test skips because no `dsh web` instance is running at `127.0.0.1:3080`).
- The required `0.2.2-rc.1` patch still matches the harness checkout: `git apply --reverse --check` succeeds against the applied `dsh-v0.2.2-rc.1` tree, and the focused patch tests previously passed 4 files / 59 tests.

The next mechanical run therefore no longer sees any range refusing `0.2.2-rc.1`, and the repository's own alignment check agrees with the manifest. The client bundle still builds and loads under the module-loader test against the `0.2.2-rc.1` client packages. The remaining validation boundary is the live browser mount, which was not available in this environment; that is the same skip the previous review recorded, not a new regression.

## 5. What you did not change

- I did not change plugin behavior, role routing, tool gating, prompt assembly, client slots, settings, or the preset composition. Those were already migrated before this attempt.
- I did not weaken or edit the end-to-end suite, its configuration, or its snapshots.
- I did not add compiler or toolchain packages. The existing `typescript`/`tsdown` entries resolved within their existing ranges during lockfile regeneration.
- I did not drop the required assistant-prefill patch; only the obsolete `0.2.1-rc.2` variant was removed when the baseline moved.
- I did not change the `@deepseek-ai/cordis` or `@deepseek-ai/schemastery` peer ranges, because they already admit the target and were not part of the failing contract.
- I did not bump the plugin's own package version, commit the checkout, open issues, or open pull requests.
- The harness checkout remains uncommitted, with the rebased patch applied for verification.