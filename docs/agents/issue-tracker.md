# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in **`bughunt8/dsh-plugin-opencode-omo`** — the maintained fork. Use the `gh` CLI for all operations.

## Which repository

This clone has two remotes, so `gh` cannot infer the target and defaults to `origin` (upstream). **Pass `--repo` explicitly.**

| Remote   | Repository                             | Use for                                              |
| -------- | -------------------------------------- | ---------------------------------------------------- |
| `fork`   | `bughunt8/dsh-plugin-opencode-omo`      | All work tracking for this fork. The default target. |
| `origin` | `royenheart/dsh-plugin-opencode-omo`    | Upstream. Read its issues; open one only when the report is genuinely upstream's. |

```bash
gh issue create --repo bughunt8/dsh-plugin-opencode-omo --title "..." --body "..."
gh issue list   --repo bughunt8/dsh-plugin-opencode-omo --state open
```

Upstream's existing backlog lives at `royenheart/dsh-plugin-opencode-omo`; read it with `gh issue list --repo royenheart/dsh-plugin-opencode-omo --state open` before filing anything upstream.

## Conventions

- **Create an issue**: `gh issue create --repo bughunt8/dsh-plugin-opencode-omo --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --repo bughunt8/dsh-plugin-opencode-omo --comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --repo bughunt8/dsh-plugin-opencode-omo --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --repo bughunt8/dsh-plugin-opencode-omo --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --repo bughunt8/dsh-plugin-opencode-omo --comment "..."`

The installed `gh` is 2.4.0, which predates `gh label`. Create and edit labels with `gh api`:

```bash
gh api repos/bughunt8/dsh-plugin-opencode-omo/labels -f name="needs-triage" -f color="fbca04"
```

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `bughunt8/dsh-plugin-opencode-omo`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo bughunt8/dsh-plugin-opencode-omo --comments`.

## Migrated from local files

Local tracking files are superseded by this tracker. Do not extend them:

- `UPGRADE-BLOCKED.md` — the blocked `0.1.2-alpha.x` bump. Tracked as an issue; the file stays as the evidence record.
- `.omo-reports/` — Loop A audit output. Untracked working files, not a backlog.
