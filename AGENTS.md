# AGENTS.md

## Upstream alignment

This repository targets one declared upstream baseline, not "latest".

- Machine-readable registry: `alignment.json` (`schemaVersion: 2`); exactly one
  `active` combination is the support claim. Inactive combinations are not
  supported merely because they are registered.
- Human-readable table: `README.md` → **Version baseline**
- Prompt extraction provenance: `presets/opencode-omo/roles/prompts/variants/MANIFEST.md`

The current baseline is the README table, backed by the active entry in `alignment.json`.
Do not update a prompt, tool description, role map, or host adaptation without
updating the active combination, its extraction manifest, and the README table
together. Run `npm run check:alignment`; CI runs it before the test suite.

## Rules for upstream work

- Prefer upstream source over memory or a newer local checkout.
- Keep harness adaptations distinct from upstream text; document them in
  `MANIFEST.md` or the relevant module header.
- Do not add a second alignment/version table. The README table and
  `alignment.json` are the only authorities.
- When adding a combination, give it a unique id, a prompt manifest, and an
  explicit reason for every reference-only role. Do not mark it active without
  a deterministic contract and trace strategy.
- Do not claim multi-version support. The current contract is one active
  combination; a version matrix and live trace harness are tracked in issue #17.
- When comparing against a live upstream, record the upstream tag/commit,
  isolated home, and normalized trace. Do not compare raw model prose.
