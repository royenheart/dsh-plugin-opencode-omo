# AGENTS.md

Instructions for an AI agent working inside this repository.

`@royenheart/dsh-plugin-opencode-omo` is a DeepSeek Harness plugin that adds the
`opencode-omo` agent preset to the web profile. This clone is the maintained fork,
`bughunt8/dsh-plugin-opencode-omo`; `origin` is upstream and `fork` is the maintained fork.
See `README.md` for what the mode provides and `design.md` for the design.

## Agent skills

### Issue tracker

GitHub issues in `bughunt8/dsh-plugin-opencode-omo`, via the `gh` CLI with an explicit `--repo`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and one `docs/adr/` at the root. See `docs/agents/domain.md`.
