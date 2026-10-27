---
name: review-work
description: "Post-implementation review orchestrator. Launches 5 parallel background sub-agents: Oracle (goal/constraint verification), Oracle (code quality), Oracle (security), deep (hands-on QA execution), deep (context mining from GitHub/git/Slack/Notion). All must pass for review to pass. MUST USE before a PR handoff or when the user explicitly asks to review completed work. Triggers: 'review work', 'review my work', 'review changes', 'QA my work', 'verify implementation', 'check my work', 'validate changes', 'post-implementation review'."
---
## Delegation surface

This session is the OpenCode + omo tool surface. Use only names in your current tool list:

- Research: `call_omo_agent(subagent_type="explore"|"librarian", ...)` or the named tools
- Review: `task(subagent_type="oracle", ...)` or `oracle(...)`
- Implementation / QA: `task(category="...", ...)`
- Collect: `background_output(task_id="bg_...")` only after a completion notice
- Follow-up: `task(task_id="ses_...", prompt=...)`

Every child prompt must be self-contained (`TASK`, `DELIVERABLE`, `SCOPE`, `VERIFY`). Review lanes are leaf agents: they do their own reading and never spawn sub-reviewers. Require `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. Do not call `multi_agent_v1.*`, `spawn_agent`, `job_output`, `job_kill`, `subagent`, or `subagent_fork`.
Fallback only when the child is
completed without the deliverable, ack-only after followup, explicitly
`BLOCKED:`, or no longer running. Then mark that review lane
`INCONCLUSIVE`, do not count it as PASS or approval, close if safe, and
respawn a smaller `fork_context: false` reviewer with the missing
deliverable. Preserve completed lane results immediately. If the retry
budget is exhausted, keep the lane `INCONCLUSIVE` and still emit a final
aggregate result.

# Review Work - 5-Agent Parallel Review Orchestrator

Launch 5 specialized sub-agents in parallel to review completed implementation work from every angle. All 5 must pass for the review to pass. If even ONE fails, the review fails.

The 5 agents cover complementary concerns - together they form a comprehensive review that no single reviewer could match:

| # | Agent | Type | Role | Focus Level |
|---|-------|------|------|-------------|
| 1 | Goal Verifier | Oracle | Did we build what was asked? | MAIN |
| 2 | QA Executor | deep | Does it actually work? | MAIN |
| 3 | Code Reviewer | Oracle | Is the code well-written? | MAIN |
| 4 | Security Auditor | Oracle | Is it secure? | SUB |
| 5 | Context Miner | deep | Did we miss any context? | MAIN |

---

## Phase 0: Gather Review Context

Before launching agents, collect these inputs. Extract from conversation history first - the user's original request, constraints discussed, and decisions made are usually already in the thread. Only ask if truly missing.

<required_inputs>

- **GOAL**: The original objective. What was the user trying to achieve? Pull from the initial request in this conversation.
- **CONSTRAINTS**: Rules, requirements, or limitations. Tech stack restrictions, performance targets, API contracts, design patterns to follow, backward compatibility needs.
- **BACKGROUND**: Why this work was needed. Business context, user stories, related systems, prior decisions that informed the approach.
- **REVIEW_MODE**: `pr` for PR/branch review, `local` for uncommitted local review.
- **BASE_REF**: `pr` only; the branch point (e.g. `main`). Use `git diff "$BASE_REF"...HEAD`.
- **CHANGED_FILES**: For `pr`: `git -C "$REVIEW_WORKTREE" diff --name-only "$BASE_REF"...HEAD`; for `local`: `git diff --name-only HEAD` plus untracked files.
- **DIFF**: For `pr`: `git -C "$REVIEW_WORKTREE" diff "$BASE_REF"...HEAD`; for `local`: `git diff HEAD` plus `git status --porcelain`.
- **FILE_CONTENTS**: Read each changed file from `REVIEW_WORKTREE` using absolute paths; never read the same relative path from the parent worktree. Oracle agents have no write/edit tools but retain shell access.
- **RUN_COMMAND**: Detect/run from `REVIEW_WORKTREE`; never from the main worktree.
- **REVIEW_PARENT_CWD**: The pre-review parent directory, captured with `pwd -P`; used to bound and identify the local review tree.
- **REVIEW_WORKTREE / REVIEW_HEAD / REVIEW_DIRTY / REVIEW_STATE**: For `pr`: an in-workspace worktree, `git -C ... rev-parse HEAD`, empty dirty output, and empty state. For `local`: set `REVIEW_WORKTREE` to the current worktree, `REVIEW_HEAD` to HEAD, `REVIEW_DIRTY` to `git status --porcelain` output, `REVIEW_STATE` to the output of the canonical state command in the preflight block, and `REVIEW_WORKTREE_OWNED=0`.

</required_inputs>


Capture `REVIEW_PARENT_CWD=$(pwd -P)` for containment. For `REVIEW_MODE=pr`, create a **new** worktree inside the session workspace with `git worktree add --detach .review-worktrees/<name>-<timestamp> <branch-or-commit>` before collection. Do not attach or reuse an existing worktree; fail if the path exists. `.review-worktrees/` is gitignored in this repository. Set `REVIEW_WORKTREE` (absolute path), `REVIEW_HEAD`, and `REVIEW_WORKTREE_OWNED=1`. The main worktree is read-only context; never checkout, test, or edit the review branch there. Every `task()` call in this skill must pass `cwd: "$REVIEW_WORKTREE"` for `pr`; for `local`, pass the current worktree. Do not move the parent's persistent shell. Pin each lane with `task(cwd:)`; the plugin's file/image/LSP shims resolve through the working directory, but escalated bash may still use the session header, so pass absolute paths there. After the review, cleanup only when `REVIEW_MODE=pr` and `REVIEW_WORKTREE_OWNED=1`: require `git -C "$REVIEW_WORKTREE" status --porcelain` empty and `git -C "$REVIEW_WORKTREE" rev-parse HEAD` equal to `REVIEW_HEAD`, run `git worktree remove "$REVIEW_WORKTREE"`, then `git worktree prune`. If removal refuses, leave the tree and report its path. Never remove a worktree the reviewer did not create.

**Preflight (fail closed before spawning lanes):**

```bash
set -o pipefail
test -n "$REVIEW_MODE" || exit 1
test "$REVIEW_MODE" = pr -o "$REVIEW_MODE" = local || exit 1
test -n "$REVIEW_WORKTREE" -a -d "$REVIEW_WORKTREE" || exit 1
case "$REVIEW_WORKTREE" in /*) ;; *) exit 1 ;; esac
printf '%s' "$REVIEW_HEAD" | grep -Eq '^[0-9a-f]{40}$' || exit 1
head=$(git -C "$REVIEW_WORKTREE" rev-parse HEAD) || exit 1
[ "$head" = "$REVIEW_HEAD" ] || exit 1
if [ "$REVIEW_MODE" = pr ]; then
  test -n "$BASE_REF" || exit 1
  test -n "$REVIEW_PARENT_CWD" -a -d "$REVIEW_PARENT_CWD" || exit 1
  workspace=$(cd "$REVIEW_PARENT_CWD" && pwd -P) || exit 1
  review=$(cd "$REVIEW_WORKTREE" && pwd -P) || exit 1
  case "$review" in "$workspace"/.review-worktrees/*) ;; *) exit 1 ;; esac
  test "$REVIEW_WORKTREE_OWNED" = 1 || exit 1
  case "$(git -C "$REVIEW_WORKTREE" rev-parse --git-dir)" in */worktrees/*) ;; *) exit 1 ;; esac
  status=$(git -C "$REVIEW_WORKTREE" status --porcelain) || exit 1
  test -z "$status" || exit 1
  changed=$(git -C "$REVIEW_WORKTREE" diff --name-only "$BASE_REF"...HEAD) || exit 1
  test -n "$changed" || exit 1
else
  [ "$(cd "$REVIEW_WORKTREE" && pwd -P)" = "$(cd "$REVIEW_PARENT_CWD" && pwd -P)" ] || exit 1
  changed=$(git -C "$REVIEW_WORKTREE" diff --name-only HEAD) || exit 1
  untracked=$(git -C "$REVIEW_WORKTREE" ls-files --others --exclude-standard) || exit 1
  test -n "$changed" -o -n "$untracked" || exit 1
  dirty=$(git -C "$REVIEW_WORKTREE" status --porcelain) || exit 1
  [ "$dirty" = "$REVIEW_DIRTY" ] || exit 1
  state=$( { git -C "$REVIEW_WORKTREE" -c core.quotePath=false diff --binary --no-ext-diff --no-textconv --no-color HEAD || exit 1; git -C "$REVIEW_WORKTREE" -c core.quotePath=false ls-files -z --others --exclude-standard | while IFS= read -r -d '' f; do [ ! -L "$REVIEW_WORKTREE/$f" ] || exit 1; [ -f "$REVIEW_WORKTREE/$f" ] || exit 1; printf '%s\0' "$f"; git -C "$REVIEW_WORKTREE" hash-object -- "$f" || exit 1; printf '\0'; done; } | git hash-object --stdin ) || exit 1
  [ "$state" = "$REVIEW_STATE" ] || exit 1
fi
```

If any check fails, return `REVIEW INCONCLUSIVE - review context invalid` and do not spawn lanes. If an owned `pr` worktree was created and is clean with HEAD still equal to `REVIEW_HEAD`, remove it with `git worktree remove "$REVIEW_WORKTREE"` and `git worktree prune`; otherwise leave it and report the path.

**Auto-collection sequence:**

```bash
# 1. Get changed files
git -C "$REVIEW_WORKTREE" diff --name-only "$BASE_REF"...HEAD  # pr
    git diff --name-only HEAD  # local
    git ls-files --others --exclude-standard  # local untracked

# 2. Get diff
git -C "$REVIEW_WORKTREE" diff "$BASE_REF"...HEAD  # pr
    git diff HEAD  # local
    git status --porcelain  # local dirty marker

# 3. Detect run command from the review worktree
# (cd "$REVIEW_WORKTREE" && check package.json -> "scripts.dev" or "scripts.start")
# Check Makefile -> default target
# Check docker-compose.yml -> services
```

For GOAL, CONSTRAINTS, BACKGROUND - review the full conversation history. The user's original message almost always contains the goal. Constraints often emerge during discussion. If anything critical is ambiguous, ask ONE focused question - not a checklist.

---

## Phase 1: Launch 5 Agents

Launch ALL 5 in a single turn. Every agent uses `run_in_background=true`. No sequential launches. No waiting between them.

**Oracle agents have no write/edit tools but retain shell access** (read/search/bash remain available). Include DIFF + FILE_CONTENTS so their review is grounded; shell can still modify files.

**deep agents are autonomous** - they can read files, run commands, and use tools. Give them goals and pointers, not raw content dumps.

---

### Agent 1: Goal & Constraint Verification (Oracle) - MAIN

This agent answers: "Did we build exactly what was asked, within the rules we were given?"

```
task(
  cwd="$REVIEW_WORKTREE",
  subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Verify implementation against original goal and constraints",
  prompt="""
<review_type>GOAL & CONSTRAINT VERIFICATION</review_type>

<original_goal>
{GOAL - paste the user's original request and any clarifications}
</original_goal>

<constraints>
{CONSTRAINTS - every rule, requirement, or limitation discussed}
</constraints>

<background>
{BACKGROUND - why this work was needed, broader context}
</background>

<changed_files>
{CHANGED_FILES - list of modified file paths}
</changed_files>

<file_contents>
{FILE_CONTENTS - full content of every changed file, clearly delimited per file}
</file_contents>

<diff>
{DIFF - the actual git diff}
</diff>

Review whether this implementation correctly and completely achieves the stated goal within the given constraints. Be obsessively thorough - the point of this review is to catch what the implementer missed.

REVIEW CHECKLIST:

1. **Goal Completeness**: Break the goal into every sub-requirement (explicit AND implied). For each, mark ACHIEVED / MISSED / PARTIAL. Missing even one implied requirement that a reasonable engineer would have addressed = PARTIAL at minimum.

2. **Constraint Compliance**: List every constraint. For each, verify compliance with specific code evidence. A constraint violated = automatic FAIL.

3. **Requirement Gaps**: Requirements the user clearly wanted but didn't spell out. Things implied by the goal or background that a thoughtful engineer would have included.

4. **Over-Engineering**: Anything added that wasn't requested - unnecessary abstractions, extra features, premature optimizations, speculative generality. Flag these as scope creep.

5. **Edge Cases**: Given the goal, what inputs or scenarios would break this? Trace through at least 5 edge cases mentally.

6. **Behavioral Correctness**: Walk through the code logic for 3+ representative scenarios. Does the code actually produce the expected behavior in each case?

OUTPUT FORMAT:
<verdict>PASS, FAIL, or INCONCLUSIVE</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<goal_breakdown>
  For each sub-requirement:
  - [ACHIEVED/MISSED/PARTIAL] Requirement description
  - Evidence: specific code reference or gap
</goal_breakdown>
<constraint_compliance>
  For each constraint:
  - [ACHIEVED/MISSED] Constraint description - evidence
</constraint_compliance>
<findings>
  - [PASS/FAIL/WARN] Category: Description
  - File: path (line range if applicable)
  - Evidence: specific code or logic reference
</findings>
<blocking_issues>Issues that MUST be fixed. Empty if PASS.</blocking_issues>
""")
```

---

### Agent 2: QA via App Execution (deep) - MAIN

This agent answers: "Does it actually work when you run it?"

```
task(
  cwd="$REVIEW_WORKTREE",
  category="deep",
  run_in_background=true,
  load_skills=[],
  description="QA by actually running and using the application",
  prompt="""
<review_type>QA - HANDS-ON APP EXECUTION</review_type>

<original_goal>
{GOAL}
</original_goal>

<constraints>
{CONSTRAINTS}
</constraints>

<changed_files>
{CHANGED_FILES}
</changed_files>

<run_command>
{RUN_COMMAND - how to start the application, or "unknown" if not determined}
</run_command>

<review_mode>
{REVIEW_MODE}
</review_mode>

<review_worktree>
{REVIEW_WORKTREE}
</review_worktree>

<review_head>
{REVIEW_HEAD}
</review_head>

<review_dirty>
{REVIEW_DIRTY - porcelain output; empty for pr}
</review_dirty>

<review_state>
{REVIEW_STATE - tracked+untracked hash; empty for pr}
</review_state>






You are a QA engineer. Your job is to RUN the application and verify it works through hands-on testing. Your working directory is `REVIEW_WORKTREE` (passed as `cwd`). If `review_mode` is neither `pr` nor `local`, report INCONCLUSIVE. Verify `git -C <review_worktree> rev-parse HEAD` equals `<review_head>`; for `pr` also require `git -C <review_worktree> status --porcelain` empty, and for `local` require it to equal `<review_dirty>` and the same tracked+untracked state hash to equal `<review_state>`. If any check fails, report INCONCLUSIVE. Compute the local state with `set -o pipefail` and this exact command:

```bash
state=$( { git -C <review_worktree> -c core.quotePath=false diff --binary --no-ext-diff --no-textconv --no-color HEAD || exit 1; git -C <review_worktree> -c core.quotePath=false ls-files -z --others --exclude-standard | while IFS= read -r -d '' f; do [ ! -L "<review_worktree>/$f" ] || exit 1; [ -f "<review_worktree>/$f" ] || exit 1; printf '%s\0' "$f"; git -C <review_worktree> hash-object -- "$f" || exit 1; printf '\0'; done; } | git hash-object --stdin ) || exit 1
``` Use the literal worktree path from `<review_worktree>` (not a shell variable) and absolute paths for every read/grep/glob and app command. Do not use apply_patch or hashline_edit. You do not review code - you test behavior.

MANDATORY PROCESS (follow in order):

### Step 1: Scenario Brainstorm

Before touching the app, write down EVERY test scenario you can think of. Be exhaustive. Think about:

- **Happy paths**: The primary use cases this implementation enables. What's the main thing the user wanted to do?
- **Boundary conditions**: Empty inputs, maximum-length inputs, zero values, negative numbers, special characters, unicode, very large datasets.
- **Error paths**: Invalid inputs, network failures, missing files, permission denied, timeout conditions.
- **Regression scenarios**: Existing features that touch the same code paths. Things that worked before and must still work.
- **State transitions**: What happens when you do things out of order? Rapid repeated actions? Concurrent usage?
- **UX scenarios** (if applicable): Layout on different sizes, keyboard navigation, screen reader compatibility, loading states, error messages.
- **Integration points**: Does this feature interact with external services, databases, or other modules? Test those boundaries.

Write each scenario as a one-liner with expected behavior. Aim for 15-30 scenarios minimum.

### Step 2: Scenario Augmentation

Review your scenario list with fresh eyes. For each scenario, ask:
- "What could go wrong here that I haven't considered?"
- "What would a malicious or careless user do?"
- "What environmental conditions could affect this?" (disk full, slow network, expired tokens)

Add at least 5 more scenarios from this reflection. Group scenarios by priority: P0 (must pass), P1 (should pass), P2 (nice to pass).

### Step 3: Create Task List

Convert your augmented scenario list into a structured task list (use TaskCreate/TaskUpdate or your todo system). Each task = one test scenario with:
- Test name
- Steps to execute
- Expected result
- Priority (P0/P1/P2)

### Step 4: Execute Systematically

Work through the task list in priority order (P0 first). For each test:

1. Execute the test steps
2. Record actual result
3. Compare with expected result
4. Mark PASS, FAIL, or INCONCLUSIVE
5. If FAIL: capture evidence (screenshot, terminal output, error message)
6. Mark the task complete

**Execution guidance by app type:**
- **Web app**: Use the browser surface already available in this session. If none is available, report INCONCLUSIVE; do not self-review visual design.
- **CLI tool**: Run commands with various arguments, pipe inputs, check exit codes and output.
- **Library/SDK**: Write and execute a test script that imports and exercises the public API.
- **Backend API**: Use curl/httpie to hit endpoints with various payloads, verify response codes and bodies.
- **Mobile/Desktop**: If not directly runnable, write integration tests and execute them.

If the app cannot be started (build failure), that's an immediate FAIL - no need to continue.

### Step 5: Compile Results

OUTPUT FORMAT:
<verdict>PASS, FAIL, or INCONCLUSIVE</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<scenario_coverage>
  Total scenarios: N
  P0: X tested, Y passed
  P1: X tested, Y passed
  P2: X tested, Y passed
</scenario_coverage>
<test_results>
  For each test:
  - [PASS/FAIL] Test name (Priority)
  - Steps: What you did
  - Expected: What should happen
  - Actual: What actually happened
  - Evidence: Screenshot path or terminal output snippet (if FAIL)
</test_results>
<blocking_issues>P0 or P1 failures only. Empty if PASS.</blocking_issues>
""")
```

---

### Agent 3: Code Quality Review (Oracle) - MAIN

This agent answers: "Is the code well-written, maintainable, and consistent with the codebase?"

```
task(
  cwd="$REVIEW_WORKTREE",
  subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Review overall code quality, patterns, and architecture",
  prompt="""
<review_type>CODE QUALITY REVIEW</review_type>

<changed_files>
{CHANGED_FILES}
</changed_files>

<file_contents>
{FILE_CONTENTS - full content of changed files AND neighboring files that show existing patterns}
</file_contents>

<diff>
{DIFF}
</diff>

<background>
{BACKGROUND}
</background>

You are a senior staff engineer conducting a code review. Your standard: "Would I approve this PR without comments?"

REVIEW DIMENSIONS (examine each):

1. **Correctness**: Logic errors, off-by-one, null/undefined handling, race conditions, resource leaks, unhandled promise rejections.

2. **Pattern Consistency**: Does new code follow the codebase's established patterns? Compare with the neighboring files provided. Introducing a new pattern where one already exists = finding.

3. **Naming & Readability**: Clear variable/function/type names? Self-documenting code? Would another engineer understand this without explanation?

4. **Error Handling**: Errors properly caught, logged, and propagated? No empty catch blocks? No swallowed errors? User-facing errors are helpful?

5. **Type Safety**: Any `as any`, `@ts-ignore`, `@ts-expect-error`? Proper generic usage? Correct type narrowing? (If TypeScript/typed language)

6. **Performance**: N+1 queries? Unnecessary re-renders? Blocking I/O on hot paths? Memory leaks? Unbounded growth?

7. **Abstraction Level**: Right level of abstraction? No copy-paste duplication? But also no premature over-abstraction?

8. **Testing**: New behaviors covered by tests? Tests are meaningful, not just coverage padding? Test names describe scenarios?

9. **API Design**: Public interfaces clean and consistent with existing APIs? Breaking changes flagged?

10. **Tech Debt**: Does this introduce new tech debt? Or create coupling that will be painful to change?

Categorize each finding by severity:
- **CRITICAL**: Will cause bugs, data loss, or crashes in production
- **MAJOR**: Significant quality issue that should be fixed before merge
- **MINOR**: Improvement worth making but not blocking
- **NITPICK**: Style preference, optional

OUTPUT FORMAT:
<verdict>PASS, FAIL, or INCONCLUSIVE</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<findings>
  - [CRITICAL/MAJOR/MINOR/NITPICK] Category: Description
  - File: path (line range)
  - Current: what the code does now
  - Suggestion: how to improve
</findings>
<blocking_issues>CRITICAL and MAJOR items only. Empty if PASS.</blocking_issues>
""")
```

---

### Agent 4: Security Review (Oracle) - SUB

This agent answers: "Are there security vulnerabilities in these changes?"

This is supplementary - it focuses exclusively on security. It does NOT comment on code style, architecture, or functionality unless those directly create a security risk.

```
task(
  cwd="$REVIEW_WORKTREE",
  subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Security-focused review of implementation changes",
  prompt="""
<review_type>SECURITY REVIEW (supplementary)</review_type>

<changed_files>
{CHANGED_FILES}
</changed_files>

<file_contents>
{FILE_CONTENTS - full content of changed files}
</file_contents>

<diff>
{DIFF}
</diff>

You are a security engineer. Review this diff exclusively for security vulnerabilities and anti-patterns. Ignore code style, naming, architecture - unless it directly creates a security risk.

SECURITY CHECKLIST:

1. **Input Validation**: User inputs sanitized? SQL injection, XSS, command injection, SSRF vectors?
2. **Auth & AuthZ**: Authentication checks where needed? Authorization verified for each action? Privilege escalation paths?
3. **Secrets & Credentials**: Hardcoded secrets, API keys, tokens in code or config? Secrets in logs?
4. **Data Exposure**: Sensitive data in logs? PII in error messages? Over-exposed API responses?
5. **Dependencies**: New dependencies added? Known CVEs? Suspicious or unnecessary packages?
6. **Cryptography**: Proper algorithms? No custom crypto? Secure random? Proper key management?
7. **File & Path**: Path traversal? Unsafe file operations? Symlink following?
8. **Network**: CORS configured correctly? Rate limiting? TLS enforced? Certificate validation?
9. **Error Leakage**: Stack traces exposed to users? Internal details in error responses?
10. **Supply Chain**: Lockfile updated consistently? Dependency pinning?

OUTPUT FORMAT:
<verdict>PASS, FAIL, or INCONCLUSIVE</verdict>
<severity>CRITICAL / HIGH / MEDIUM / LOW / NONE</severity>
<summary>1-3 sentence overall assessment</summary>
<findings>
  - [CRITICAL/HIGH/MEDIUM/LOW] Category: Description
  - File: path (line range)
  - Risk: What could an attacker do?
  - Remediation: Specific fix
</findings>
<blocking_issues>CRITICAL and HIGH items only. Empty if PASS.</blocking_issues>
""")
```

---

### Agent 5: Context Mining (deep) - MAIN

This agent answers: "Did we miss any context that should have informed this implementation?"

```
task(
  cwd="$REVIEW_WORKTREE",
  category="deep",
  run_in_background=true,
  load_skills=["git-master"],
  description="Mine all accessible contexts for missed requirements or background knowledge",
  prompt="""
<review_type>CONTEXT MINING - MISSED REQUIREMENTS & BACKGROUND</review_type>

<original_goal>
{GOAL}
</original_goal>

<constraints>
{CONSTRAINTS}
</constraints>

<changed_files>
{CHANGED_FILES}
</changed_files>

<review_worktree>
{REVIEW_WORKTREE}
</review_worktree>

<background>
{BACKGROUND}
</background>

You are an investigator. Your mission: search every accessible information source to find context that should have informed this implementation but might have been missed. The question: "Is there something we should have known but didn't?"

SOURCES TO SEARCH (use every available tool):

1. **Git History** (ALWAYS search):
   - `git log --oneline -20 -- {each changed file}` - recent changes and their reasons
   - `git blame {critical sections}` - who wrote what and when
   - `git log --all --grep="{keywords from goal}"` - related commits
   - Look for reverted commits, TODO/FIXME/HACK comments in history

2. **GitHub** (if `gh` CLI available):
   - `gh issue list --search "{keywords}"` - related open/closed issues
   - `gh pr list --search "{keywords}" --state all` - related PRs and their review comments
   - Check if any issue is specifically linked to this work
   - Look at review comments on past PRs touching these files

3. **Communication Channels** (if MCP tools available):
   - Slack: search for messages mentioning the feature, file names, or related keywords
   - Notion: search for design docs, RFCs, ADRs related to this feature
   - Discord: relevant discussions

4. **Codebase Cross-References** (ALWAYS search):
   - Files that import or reference the changed modules
   - Tests that might need updating due to behavior changes
   - Documentation (README, docs/, comments) that references changed behavior
   - Config files that might need corresponding updates
   - Related features in the same domain

WHAT TO LOOK FOR:

- Requirements mentioned in issues/PRs that the implementation misses
- Past decisions explaining WHY code was written a certain way - and whether new changes respect those reasons
- Related systems or features affected by these changes
- Warnings from previous developers (PR review comments, inline TODOs, commit messages)
- Migration or deprecation notes that affect the changed code
- Design decisions documented outside the codebase (Notion, Slack, ADRs)

OUTPUT FORMAT:
<verdict>PASS, FAIL, or INCONCLUSIVE</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<sources_searched>
  - [SEARCHED/SKIPPED] Source name - what was searched (or why it wasn't accessible)
</sources_searched>
<discovered_context>
  For each discovery:
  - Source: Where found (git commit abc123, GitHub issue #42, Slack message, etc.)
  - Finding: What was found
  - Relevance: How it relates to the current work
  - Impact: [BLOCKING / IMPORTANT / FYI]
</discovered_context>
<missed_requirements>Requirements the implementation should address but doesn't. Empty if none.</missed_requirements>
<blocking_issues>BLOCKING items only. Empty if PASS.</blocking_issues>
""")
```

---

## Phase 2: Wait & Collect

After launching all 5 agents in one turn, wait for completions in bounded
cycles. Do not treat a timeout, ack-only reply, or empty child result as
a PASS.

As each completes, collect via `background_output(task_id="bg_...")`
after the completion notice, then the child's substantive final result. Preserve completed lane
results immediately; never lose a PASS/FAIL because another lane is
still running. Store each verdict independently:

| Agent | Verdict | Notes |
|-------|---------|-------|
| 1. Goal Verification | pending/PASS/FAIL/INCONCLUSIVE | - |
| 2. QA Execution | pending/PASS/FAIL/INCONCLUSIVE | - |
| 3. Code Quality | pending/PASS/FAIL/INCONCLUSIVE | - |
| 4. Security | pending/PASS/FAIL/INCONCLUSIVE | - |
| 5. Context Mining | pending/PASS/FAIL/INCONCLUSIVE | - |

Do NOT deliver the final report until ALL 5 lanes have a terminal state:
PASS, FAIL, or INCONCLUSIVE.
If a lane remains silent after the reliability followup, record it as
inconclusive and respawn a smaller reviewer/worker for that exact lane.
If it still remains unfinished after that retry, close the still-running
agent if safe, keep the lane INCONCLUSIVE, and emit the final aggregate
review result with the incomplete lane named. Do not spin in repeated
wait/followup cycles. Do not use a follow-up prompt as an interrupt; queued
followups are not cancellation.

---

## Phase 3: Deliver Verdict

<verdict_logic>

Evaluate in order; first match wins.

ALL 5 agents returned PASS → **REVIEW PASSED**
ANY agent returned FAIL → **REVIEW FAILED - criteria not met**
ANY lane is INCONCLUSIVE and none failed → **REVIEW INCONCLUSIVE - not approved**

</verdict_logic>

Compile the final report in this format:

```markdown
# Review Work - Final Report

## Overall Verdict: PASSED / FAILED / INCONCLUSIVE

| # | Review Area | Agent Type | Verdict | Confidence |
|---|------------|------------|---------|------------|
| 1 | Goal & Constraint Verification | Oracle | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |
| 2 | QA Execution | deep | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |
| 3 | Code Quality | Oracle | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |
| 4 | Security (supplementary) | Oracle | PASS/FAIL/INCONCLUSIVE | Severity |
| 5 | Context Mining | deep | PASS/FAIL/INCONCLUSIVE | HIGH/MED/LOW |

## Blocking Issues
[Aggregated from all agents - deduplicated, prioritized]

## Key Findings
[Top 5-10 most important findings across all agents, grouped by theme]

## Recommendations
[If FAILED: exactly what to fix, in priority order]
[If PASSED: non-blocking suggestions worth considering]
```

If FAILED - be specific. The user should know exactly what to fix and in what order. No vague "consider improving X" - state the problem, the file, and the fix.

If PASSED - keep it short. Highlight any non-blocking suggestions, but don't turn a passing review into a lecture.
