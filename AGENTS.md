# DoctorCRE Engine

The engine behind the DoctorCRE app. It serves the partners' business records (deals, clients, leads, contacts, vendors, activity) to the app, to background jobs and to agents. It is replacing the old system in `DoctorCRE/carr-system` one piece at a time. Both run against the same database until the old one serves nothing.

Read `docs/system.md` first, and the matching file in `docs/screens/` for screen work. A brief or pull request never makes a design decision the docs do not already make; it reports it instead. A pull request that changes what a doc describes updates that doc in the same pull request.

## This repo is public

Code, issues, pull requests, commit messages and CI logs are visible to anyone. Never put a real client, contact, deal, address, email, phone number or secret in any of them. Tests use made-up data. Refer to a real record only by its ID.

## How work happens

1. Work starts from a GitHub issue, and the issue number is the job's ID. If the owner asks for something in chat, open the issue first.
2. An issue title says the outcome in plain words the owner would use, such as "Deals board loads from the new engine". No IDs, file names or jargon in titles.
3. One issue gets one branch named `<issue>-<short-name>` and one pull request that says `Closes #<issue>`.
4. Run `npm run check` before pushing. CI runs the same command and nothing else.
5. Once the review passes, the coordinator turns on auto-merge, pinned to the head that was reviewed. The merge queue merges the pull request when the check is green. Never push to main.
6. Work is done when it is merged and you have checked the result where it runs. Say what you checked in the pull request.

Large work is a parent issue with sub-issues. Each sub-issue gets its own pull request unless it is part of a screen batch or a project batch. A screen batch puts the remaining approved units of one screen on one branch, in one pull request, with one review. A project batch puts the approved slices of one project whose drawing the owner approved on one branch, in one pull request, with one review and one fix round, merged on the owner's word.

## Stay on the task

- Do what the issue says and nothing else. If you notice something else worth doing, open an issue for it and keep going.
- Keep a pull request under about 400 changed lines, or about 1,200 for a screen batch. A project batch has no fixed line cap, but must fit in one review. The pull request states its size. Leave lockfiles and generated files out of both counts. Split bigger work into sub-issues. Fix failing tests inside the batch before review and never skip them.
- If the check fails on main, fixing it comes before any other work.

## Choosing how to do something

Use the first of these that does the job:

1. A feature of a platform we already use: GitHub, Cloudflare, Neon, T3 Code.
2. A maintained open-source package, used through its documented entry point.
3. A small script in this repo, when a step is the same every time.
4. Model judgment, when the step really needs it.

When a pull request adds a dependency or a script, say in one line which of 1 and 2 you checked first.

## Do not build process machinery

This repo has one check, one ruleset and this file. Do not add hooks, gates, extra CI jobs or workflows, bots, rule files, registries, receipts, proofs, checks that test other checks, or new sections here. Changing `AGENTS.md`, `.github/` or the scripts in `package.json` needs an issue in which the owner asked for that change.

## Changing the rules

`.github/CODEOWNERS` gives the owner `AGENTS.md`, `CLAUDE.md` and `.github/`. A pull request that changes any of them needs an issue in which the owner asked for the change. Then it merges like any other pull request. A separate session that did not write the change reviews it, and the coordinator turns on auto-merge pinned to the head that was reviewed. Nobody uses `--admin` or any other bypass.

## Skills

Build work starts in pstack's poteto-mode: `/pstack:poteto-mode` in Claude Code, `$poteto-mode` in Codex. Use pstack and the other installed skills straight from upstream. Never copy or wrap a skill in this repo.

This file wins over any skill or global rule. A skill's advice to add a lint, check, script or rule is advice about product code only; it never overrides "Do not build process machinery". The old system's Cards, Work Requests, standing orders and team memory do not apply here.

## Who does what

A Claude session coordinates: it slices issues, briefs workers, arranges each review and decides. It does not write the code. It starts each worker with T3's `delegate_task` in its own worktree, one worker per issue.

Codex gpt-6.2-sol builds. Claude Opus 5.5 may also build. Codex gpt-6.1-terra may build routine work such as wording, docs, and small app fixes. Reasoning effort is high, never higher.

Before a pull request merges, a separate session that did not write the change reviews it for correctness and code quality. A reviewer from another model family is a bonus when available, never a requirement. The builder fixes what the review finds. The owner does not review code.

Check which models are available each time you start a worker. Never write a provider's usage or balance into this repo.

## The old system

Read `carr-system` to learn what a feature does. Never copy its code. Port the behavior the partners use, write it fresh and small, and check the result on the real screen against a copy of production. It is right when the screen shows the records, counts and values a partner relies on, and saves land.

Start from the Graphify code maps, built locally in code-only mode outside this repo (your brief gives the commands): the old system's map for definitions and call chains, the engine's alongside grep.

## Code

- TypeScript, strict. One Cloudflare Worker in `src/`.
- Write code a senior developer would be glad to inherit: lean, small functions, precise types, names from `docs/glossary.md`. Delete before adding.
- Comment only what the code cannot say: a non-obvious reason, a rule kept from the old system, or a trap. One short line; never restate the code.
- Every behavior change comes with a test that fails without it.
- Tests are hermetic: no network, no production data, no sleeps, no order dependence. A test that fails and then passes on a rerun is a bug to fix that day, not to retry.
- The check must stay under 3 minutes. CI stops it at 5.
- Business rules that must always hold belong in database constraints, not only in code.
- Lasting decisions go in `docs/decisions.md`, one short paragraph each.
