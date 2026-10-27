# Prompt variant extraction manifest

Sisyphus family overlays in this directory (and `../family/`) and the
atlas / hephaestus / oracle / metis / momus rows below were re-extracted
from oh-my-openagent `v5.0.0-beta.31` (`62ed795`). Librarian / explore /
multimodal-looker still come from the earlier pin `14083b89`.

Harness-only adaptations (not present upstream):

- `interactive_bash` → persistent `bash`; Atlas `codegraph_*` and `context7`
  references are replaced with the tools this harness actually mounts.
- Prompt tool names use the dsh surface (`read`/`write`/`edit`/`bash`/
  `todo_write`/`task`), not opencode display names.
- Atlas `{{CATEGORY_SKILLS_DELEGATION_GUIDE}}` was removed where no distinct
  guide exists; `{SKILLS_SECTION}` remains.
- Atlas final-wave instructions mark both registered todos; visual-qa is an
  independent optional check, not a review-work gate.
- Metis/Explore describe their filesystem capability as write-tool-restricted;
  shell is retained and can modify files. Oracle relies on the live role filter.

Dynamic `${...}` / `{{ ... }}` / `{CATEGORY_SECTION}` placeholders stay in the
Sisyphus/Hephaestus/specialist files and are rendered by `driver.mjs`. Atlas
static files are primary-only and are not the delegated worker body.

The source paths below are upstream paths. The local `reference/` checkout is
v4.19.0; v5 rows refer to the same path at `62ed795`.

All target paths are relative to `presets/opencode-omo/roles/prompts/variants/`.

## sisyphus/kimi-k2-6.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/sisyphus/kimi-k2-6.ts`
- Extracted constant/builder: full built body (the 113-line `executionLoopBlock` is one section)
- Line count (wc -l): 405
- Caveats: Full variant body, not only the largest block.

## sisyphus/kimi-k2-7.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/sisyphus/kimi-k2-7.ts`
- Extracted constant/builder: full built body (the 30-line `executionBlock` is one section)
- Line count (wc -l): 138
- Caveats: Full variant body, not only the largest block.

## sisyphus/claude-fable-5.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/sisyphus/claude-fable-5.ts`
- Extracted constant/builder: `return `...`;` template literal of `buildClaudeFable5SisyphusPrompt` (full built body)
- Line count (wc -l): 373
- Caveats: File has no const template; extracted the single return template literal, which is the full built variant body with dynamic `${...}` placeholders intact.

## sisyphus/claude-opus-4-8.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/sisyphus/claude-opus-4-8.ts`
- Extracted constant/builder: `return `...`;` template literal of `buildClaudeOpus48SisyphusPrompt` (full built body)
- Line count (wc -l): 373
- Caveats: File has no const template; extracted the single return template literal, which is the full built variant body with dynamic `${...}` placeholders intact.

## hephaestus/gpt.md

- Reference source: oh-my-openagent `v5.0.0-beta.31` `packages/omo-opencode/src/agents/hephaestus/gpt.ts`
- Extracted constant/builder: main `return `...`;` template literal of `buildHephaestusPrompt`
- Line count (wc -l): 241
- Caveats: No single template constant. Extracted the main return-template body. `${oracleSection ? ... : ""}` was kept as `${oracleSection}`. `${todoDiscipline}` and other dynamic `${...}` placeholders stay and are rendered by `familySection`.

## hephaestus/gpt-5-4.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/hephaestus/gpt-5-4.ts`
- Extracted constant/builder: concatenation of block consts `identityBlock`, `intentBlock`, `exploreBlock`, `constraintsBlock`, `executionBlock`, `trackingBlock`, `progressBlock`, `delegationBlock`, `communicationBlock` in builder return order
- Line count (wc -l): 227
- Caveats: No single template constant. Expanded the builder return (`identityBlock` … `communicationBlock`) in order. `${hasOracle ? ... : ""}` was kept as `${oracleSection}`. `${todoDiscipline}` and other dynamic `${...}` placeholders stay and are rendered by `familySection`.

## hephaestus/gpt-5-5.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/hephaestus/gpt-5-5.ts`
- Extracted constant/builder: `const HEPHAESTUS_GPT_5_5_TEMPLATE`
- Line count (wc -l): 210
- Caveats: None

## hephaestus/gpt-5-6.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/hephaestus/gpt-5-6.ts`
- Extracted constant/builder: `const HEPHAESTUS_GPT_5_6_TEMPLATE`
- Line count (wc -l): 148
- Caveats: None

## atlas/default.md

- Reference source: `reference/oh-my-openagent/packages/prompts-core/prompts/atlas/default.md`
- Extracted constant/builder: verbatim copy with harness adaptations
- Line count (wc -l): 494
- Caveats: Harness adaptations apply (tool names, Codegraph/context7 removal, notepad bootstrap, visual-qa guidance, final-wave todo).

## atlas/gemini.md

- Reference source: `reference/oh-my-openagent/packages/prompts-core/prompts/atlas/gemini.md`
- Extracted constant/builder: verbatim copy with harness adaptations
- Line count (wc -l): 524
- Caveats: Harness adaptations apply (tool names, Codegraph/context7 removal, notepad bootstrap, visual-qa guidance, final-wave todo).

## atlas/glm.md

- Reference source: `reference/oh-my-openagent/packages/prompts-core/prompts/atlas/glm.md`
- Extracted constant/builder: verbatim copy with harness adaptations
- Line count (wc -l): 401
- Caveats: Codegraph/context7 removal, todo/tool-name adaptation, notepad bootstrap, visual-qa guidance, final-wave todo wording.

## atlas/gpt.md

- Reference source: `reference/oh-my-openagent/packages/prompts-core/prompts/atlas/gpt.md`
- Extracted constant/builder: verbatim copy with harness adaptations
- Line count (wc -l): 459
- Caveats: Harness adaptations apply (tool names, Codegraph/context7 removal, notepad bootstrap, visual-qa guidance, final-wave todo); GPT-5.5 calibration labels were relabeled to GPT-family.

## atlas/kimi-k2-7.md

- Reference source: `reference/oh-my-openagent/packages/prompts-core/prompts/atlas/kimi-k2-7.md`
- Extracted constant/builder: verbatim copy with harness adaptations
- Line count (wc -l): 324
- Caveats: Harness adaptations apply (tool names, Codegraph/context7 removal, notepad bootstrap, visual-qa guidance, final-wave todo).

## atlas/kimi-k3.md

- Reference source: `reference/oh-my-openagent/packages/prompts-core/prompts/atlas/kimi-k3.md`
- Extracted constant/builder: verbatim copy with harness adaptations
- Line count (wc -l): 324
- Caveats: Harness adaptations apply (tool names, Codegraph/context7 removal, notepad bootstrap, visual-qa guidance, final-wave todo).

## atlas/kimi.md

- Reference source: `reference/oh-my-openagent/packages/prompts-core/prompts/atlas/kimi.md`
- Extracted constant/builder: verbatim copy with harness adaptations
- Line count (wc -l): 476
- Caveats: Harness adaptations apply (tool names, Codegraph/context7 removal, notepad bootstrap, visual-qa guidance, final-wave todo).

## atlas/opus-4-7.md

- Reference source: `reference/oh-my-openagent/packages/prompts-core/prompts/atlas/opus-4-7.md`
- Extracted constant/builder: verbatim copy with harness adaptations
- Line count (wc -l): 492
- Caveats: Harness adaptations apply (tool names, Codegraph/context7 removal, notepad bootstrap, visual-qa guidance, final-wave todo).

## specialists/oracle-default.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/oracle.ts`
- Extracted constant/builder: `const ORACLE_DEFAULT_PROMPT`
- Line count (wc -l): 110
- Caveats: None

## specialists/oracle-gpt.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/oracle.ts`
- Extracted constant/builder: `const ORACLE_GPT_PROMPT`
- Line count (wc -l): 79
- Caveats: None

## specialists/oracle-gpt-5-5.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/oracle.ts`
- Extracted constant/builder: `const ORACLE_GPT_5_5_PROMPT`
- Line count (wc -l): 163
- Caveats: Capability wording adapted to “no write/edit/patch tools; shell retained”.

## specialists/metis-default.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/metis.ts`
- Extracted constant/builder: `const METIS_SYSTEM_PROMPT`
- Line count (wc -l): 271
- Caveats: Capability wording adapted to write-tool-restricted; contains `${buildAntiDuplicationSection()}` placeholder, preserved as-is.

## specialists/metis-kimi-k2-7.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/metis.ts`
- Extracted constant/builder: `const METIS_K2_7_SYSTEM_PROMPT`
- Line count (wc -l): 95
- Caveats: Capability wording adapted to write-tool-restricted; contains `${buildAntiDuplicationSection()}` placeholder, preserved as-is.

## specialists/momus-default.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/momus.ts`
- Extracted constant/builder: `const MOMUS_DEFAULT_PROMPT`
- Line count (wc -l): 176
- Caveats: None

## specialists/momus-gpt.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/momus.ts`
- Extracted constant/builder: `const MOMUS_GPT_PROMPT`
- Line count (wc -l): 75
- Caveats: None

## specialists/momus-gpt-5-6.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/momus-gpt-5-6.ts`
- Extracted constant/builder: `const MOMUS_GPT_5_6_PROMPT`
- Line count (wc -l): 52
- Caveats: None

## specialists/librarian.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/librarian.ts`
- Extracted constant/builder: `prompt: `...`` template literal in `createLibrarianAgent`
- Line count (wc -l): 277
- Caveats: Single prompt used for all models. Preserves dynamic `${new Date().getFullYear()}` / `${new Date().getFullYear() - 1}` placeholders and the literal `${TMPDIR:-/tmp}` shell expansions.

## specialists/explore.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/explore.ts`
- Extracted constant/builder: `prompt: `...`` template literal in `createExploreAgent`
- Line count (wc -l): 77
- Caveats: Single prompt used for all models; capability wording adapted to write-tool-restricted; no dynamic `${...}` placeholders.

## specialists/multimodal-looker.md

- Reference source: `reference/oh-my-openagent/packages/omo-opencode/src/agents/multimodal-looker.ts`
- Extracted constant/builder: `prompt: `...`` template literal in `createMultimodalLookerAgent`
- Line count (wc -l): 36
- Caveats: Single prompt used for all models; no dynamic `${...}` placeholders.

## Skill harness adaptations

`skills/review-work` keeps the upstream five-lane structure; `visual-qa` is an
independent optional check. It runs a fail-closed preflight, creates and owns a
fresh detached worktree for `pr`, and passes `cwd` to every lane. The QA lane receives `REVIEW_MODE`,
`REVIEW_WORKTREE`/`REVIEW_HEAD`/`REVIEW_DIRTY`/`REVIEW_STATE`; for `pr` it
verifies HEAD and clean status, for `local` it verifies HEAD, dirty status, and a
tracked+untracked content hash. Cleanup removes only a
review-created, clean worktree. Review-work does not consume a visual-qa verdict.
The dsh preset does not ship the upstream browser skills, so the QA lane uses
`load_skills=[]` and reports `INCONCLUSIVE` when no browser surface exists.

`skills/visual-qa` uses the dsh `read_image` tool and describes Oracle as
write-tool-restricted with shell retained; these are harness adaptations.
