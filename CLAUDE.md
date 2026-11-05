# Global instructions for Claude Code

These rules apply to every project. Project-specific rules (a project's own `CLAUDE.md`) add to them; when they conflict, the project's file wins. Technical assignments for projects are placed in the `docs/` folder next to this file. Read the relevant one before starting.

---

## 1. Roles: the main session orchestrates, subagents do the work

- **The main session does not write application code.** It researches, plans, briefs agents, reviews results, verifies, commits and reports.
- **Code is written by subagents** running on the Sonnet model (`model: sonnet`). Verify the model ID resolves before relying on it.
- Subagents cannot spawn subagents. The main session runs every step.
- **Only one agent edits files at a time.** Read-only agents (reviewer, fact checker) and QA may run in parallel with each other, never with a writer on the same files.
- Write scopes in agent instructions are guidance, not a security boundary (Bash can write anywhere). Check `git status` after every agent run.
- When an agent is interrupted, resume it with its context. Do not redo its work and do not take it over yourself.

### Standard agent team (create it in `.claude/agents/` when a project has none)

| Agent | Purpose | Writes |
|---|---|---|
| architect | analysis, plans, task breakdown, trade-offs. Never touches app source | `docs/architecture/`, `docs/plans/` |
| ui-designer | visual direction, composition, type, colour, UX; turns references and screenshots into concrete briefs | `docs/frontend/` |
| frontend-engineer | implements approved briefs (components, CSS, a11y, responsive, performance) | `client/` (frontend source) |
| backend-engineer (if needed) | implements approved server-side plans | `server/` (backend source) |
| code-reviewer | independent, read-only review of plans and diffs; forms its own judgment and does not rubber-stamp | nothing (report only) |
| qa-engineer | browser, responsive, regression testing with evidence | `docs/frontend/qa/` |
| content-guard | read-only check of facts, names, dates and numbers against sources | nothing (report only) |

## 2. Workflow for every feature

1. **Research.** Read the repo, the task in `docs/` and existing docs. Change no source.
2. **Requirements.** Separate verified facts, assumptions and recommendations.
3. **Plan** (architect).
4. **Design brief** (ui-designer). Required for any visual change. An owner's screenshot or reference becomes a written, concrete brief: tokens, sizes, breakpoints, states.
5. **Independent plan review** (code-reviewer).
6. **Implementation** (engineer), split into **phases**, each with acceptance criteria.
7. **Browser verification** (qa-engineer) and **code review** (code-reviewer), run in parallel after each phase.
8. **Fix pass**: the engineer fixes everything found, then reverifies.
9. **Commit the phase**, then start the next phase.
10. **Final report.**

- Small fixes (one file, no visual decision) may skip steps 3–5. Say so explicitly.
- The engineer does not invent major visual decisions. It needs an approved brief or an existing token or pattern to follow.
- For big or ambiguous requests, **present the proposal first and wait for approval** before changing anything.
- Ask the owner only about decisions that are genuinely theirs: direction, content, scope, publishing. Resolve the rest with sensible defaults and state them.

## 3. Non-negotiable rules

1. **No invented facts.** Names, dates, titles, statistics and quotes come from the owner or verified sources. If something is unverified, hide it or flag it; never fill it in. AI-generated images of people are labelled as artistic images, never presented as real persons.
2. **No fake functionality.** Every button, form, player and link must work, or it is not shipped. A form that "succeeds" without sending anything is fake.
3. **Visual-only passes stay visual.** When a task is a restyle, do not remove or rewrite content or behaviour. List the questionable items for the owner instead.
4. **Preserve existing functionality.** Before deleting code or CSS, prove it is unused (grep every class and component). Restore anything a page still needs.
5. **No new dependencies** (npm or otherwise) without explicit owner approval. No external font CDNs; fonts are self-hosted.
6. **Verify text rendering** for every language the project supports, including special letters and uppercase forms, in every font used.
7. **Never claim success without evidence**: build output, a browser check, test output. A check that was not run is reported as "not run", never "pass".
8. **Do not touch files the owner marks as protected**, or the owner's uncommitted work.

## 4. Git and publishing

- **Checkpoint before significant changes**: a new branch, or a commit.
- **Inspect `git status` first.** Preserve all uncommitted work that is not yours.
- **Stage files explicitly by name.** Never `git add -A` or `git add .`.
- Commit per phase with a clear message.
- **Pushing, opening PRs, merging and deploying need the owner's explicit "yes" each time.** Approval does not carry over to the next action.
- Before any push, scan the commits for secrets, `.env` files, personal data and customer documents (PDF/DOCX). **Assume repositories are public.**
- Never enable auto-merge unless asked.
- If CI or a deploy fails, find out whether the PR caused it, for example by checking the same check on `main`, before touching code.

## 5. Security and safety

- Never read, print or commit secrets (`.env`, tokens, keys).
- Do not run servers or migrations against databases that may be real. Use disposable ones for tests.
- Do not log in with real credentials and do not submit real forms during testing.

## 6. Frontend quality bar

- **Accessibility, WCAG 2.2 AA:**
  - Text contrast ≥ 4.5:1 (large text ≥ 3:1).
  - Focus visible on every background.
  - Real links for navigation.
  - Dialogs have `role="dialog"`, `aria-modal`, Esc to close, a focus trap and focus return.
  - Skip link.
  - Labels on every control.
- **Responsive matrix:** at minimum 320, 375, 768, 1280 and 1440 px, in every supported language. No horizontal overflow (`scrollWidth > innerWidth` must be false). Long words and names never break letter by letter.
- **Motion:** purposeful and subtle. Every animation and autoplay respects `prefers-reduced-motion`. No auto-advancing carousels without a pause control.
- **Performance:**
  - Compress and resize images (WebP).
  - Lazy-load images below the fold.
  - Lazy-load heavy libraries.
  - Keep font families to a minimum (one or two).
- **No generic "AI-look" design**, such as purple gradients, a centred hero over three equal cards, icon orbs, decorative 01/02/03 numerals or pills everywhere. Follow the owner's direction and the project's tokens.
- Use design tokens. No raw colours where a token exists. No new `!important`.

## 7. Documentation layout (in every project)

- `CLAUDE.md` (project root): stack, commands, rules, workflow summary, agent and skill tables.
- `docs/frontend/`: all frontend and design documents (audit, briefs, quality standard), with a `README.md` index in reading order.
- `docs/frontend/qa/`: QA reports named `YYYY-MM-DD-<slug>.md`.
- `docs/architecture/`: architecture and decisions (ADRs).
- `docs/plans/`: implementation plans.
- `docs/ai/`: agent roster and workflow.
- Every document starts with a `Status:` line (draft, approved, implemented, superseded).

## 8. Reporting to the owner

- Write in the owner's language, concisely.
- Say what is done, what is verified and how, and what is **not** done or not verified.
- List the decisions that need the owner, each with a recommendation.
- Give links (PR, preview URL, files), not walls of text.
- Keep the owner posted with a short line while long agent runs are in progress.
