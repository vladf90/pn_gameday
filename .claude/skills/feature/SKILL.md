---
name: feature
description: Multi-phase feature development workflow — requirements discussion, ADR, GitHub issues, implementation, PR review. Use this when the user wants to start a new feature or asks for "the feature workflow". Skip phases the user has clearly already completed (e.g., they hand you an ADR and want issues created).
---

# Feature Development Workflow

Walk the user through the five phases below. Start at Phase 1 unless context makes clear they're resuming mid-workflow.

Between phases, **stop and confirm with the user** before moving on. Do not chain phases silently.

---

## Phase 1 — Requirements Discussion

Interactive spec discussion. **Ask clarifying questions before writing any code or documents.** Cover:

- **Scope** — What's in, what's out, what's a future iteration?
- **Users / permissions** — Who is this for? Which role(s)?
- **Edge cases** — Empty states, errors, concurrency, large data, partial failures
- **UX** — Discovery, happy path, error feedback, mobile vs desktop

Use `AskUserQuestion` for multiple-choice decisions; ask freeform questions otherwise. Don't advance to Phase 2 until the spec is solid enough to write down.

---

## Phase 2 — Architecture Decision Record (ADR)

Write the ADR to `docs/adr/NNNN-title.md`, where `NNNN` is the next zero-padded number. Check existing ADRs in `docs/adr/` to pick the number. Create the directory if it doesn't exist.

Format:

- **Context** — Why this matters, the problem, the constraints
- **Decision** — What we're going to do, and *why* (briefly mention rejected alternatives)
- **Technical approach** — Architecture sketch: affected packages, entities, routes, components, migrations

ADRs are decision records, not detailed designs. Keep them focused.

After writing the ADR, show the user the path and ask whether to proceed to Phase 3.

---

## Phase 3 — Task Breakdown (GitHub Issues)

Break the ADR into GitHub issues using `gh issue create`. Each issue should have:

- Clear, action-oriented title
- Body referencing the ADR path (`docs/adr/NNNN-title.md`)
- Acceptance criteria as a markdown checklist
- Appropriate labels (see below)
- Dependency notes when an issue depends on another being merged first

### Labels

- `backend` — API, controllers, database access
- `frontend` — React components, UI
- `database` — Schema changes
- `migration` — Requires a TypeORM migration
- `bug` — Bug fix
- `enhancement` — New feature/improvement

If a label doesn't exist yet, create it with `gh label create`.

After creating the issues, list them back to the user and confirm before moving on.

---

## Phase 4 — Implementation

Pick up issues in dependency order and implement autonomously. Prompt the user only when genuinely uncertain about something the ADR didn't cover.

### Branching

- Base branch: `main`
- Feature branches: `feature/<issue-number>-short-description` (e.g., `feature/42-add-export`)
- One PR per issue when possible
- Before pushing to an existing branch/PR, check with `gh pr view <number>` whether the PR has already been merged. If merged, branch from `main` and open a new PR.

### Opening the PR

Use `gh pr create` with a body that:

- Closes the issue (`Closes #N`)
- Summarizes the change in 1–3 bullets
- Includes a test plan checklist

---

## Phase 5 — PR Review

**Never self-merge.** Wait for the user to review and merge.

Address review feedback with new commits on the same PR. If the PR has already been merged when feedback arrives, open a follow-up PR from a new branch off `main`.
