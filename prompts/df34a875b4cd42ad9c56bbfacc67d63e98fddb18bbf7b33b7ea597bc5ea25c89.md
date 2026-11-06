You are mapping a third-party DeepSeek Harness (dsh) plugin onto the official extension points of a harness release (plugin-first composition, self-contained dsh.bundle, slots, settings).

The harness records its design decisions as Agent Notes under its own `.agents/notes/`: read them as evidence, but never write design-note files into this third-party plugin repository — everything left in its tree is proposed to its maintainers as a reviewed pull request.

First principle: keep the plugin's documented unique behavior complete, including every documented entry point. Unique behavior is the plugin's product form, not "whatever remains after preferring official extension points".

Prefer an official extension point over a harness patch only when that extension point is the one the capability needs (the same slot, menu, RPC, or setting). If official extension points can host a coarser or different UX (for example a settings page instead of a workspace-row menu), that is not "doing the job" — keep or rebase the patch so the documented entry stays complete. Do not treat a plugin's silent degrade or best-effort fallback as a reason to drop the patch or the entry. Do not change unique behavior unless the harness covers that specific entry point.

If a patch is still required, update or write it so the documented behavior stays complete. You MAY run small checks. Do not commit. Do not open issues or pull requests.

Write a markdown report with these sections:
1. Extension points the plugin uses now (slots, RPCs, settings, dsh-side changes)
2. Official extension points it should use on this harness release
3. Edits you made
4. Remaining gaps that still need a harness patch or a general-purpose harness change (link Discussions if relevant)
5. Risks

The report is the last markdown document you print — printing it is the deliverable, and it is never written into the plugin tree. Do not wrap it in a code fence.


Harness source for `dsh-v0.2.2-rc.1` is at `/github/workspace/.dsh-migrate/harness`. First read the plugin README, other project docs, and the plugin's patches/ directory (the complete-surface requirement). Treat documented features and entry points as the product spec. Then, for each documented capability, decide whether the harness covers that specific entry point — official extension points cover a capability only when they are the same slot, menu, RPC, or behavior, not when a different official entry point could substitute a coarser job. If a patch is still required for a documented capability, update or write it, apply it on that checkout to test, and keep the plugin updated. Do not drop a patch because the plugin degrades without it. Do not commit the checkout.

For each remaining required patch, write one report at `.dsh-migrate/patch-reports/<slug>/report.md`. Search https://github.com/deepseek-ai/deepseek-harness issues, pull requests, and discussions first. If a related request exists, put its links in that report. If none exists, write the report as a discussion draft with these sections: Title (`# [Feature request] …`), English summary (blockquote), Background, Current state, Proposal, Appendix: patch, Questions to confirm, Related.
