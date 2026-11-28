# Doc's harness

This drawing is for owner approval in [#1509](https://github.com/DoctorCRE/doctorcre-engine/issues/1509). Doc helps a partner work in DoctorCRE. The first run follows a deal, cites its current records, and prepares a reply to one exact email. The partner edits and saves the draft, then decides whether to send it in reply review.

## The parts and their connection

- **DoctorCRE.** Ask Doc takes the question, shows its sources, and asks for confirmation. Doc link claims work for the partner. The engine owns private chat, preferences, business tools, access checks, evidence, and saves. Checked-in Doc instructions govern tool use, access checks and confirmed saves. Doc queries approved playbooks and business guidance from the engine's knowledge store. [Knowledge drawing](https://github.com/DoctorCRE/doctorcre-engine/pull/1520)
- **Base harness.** Claude Code or Codex runs the model loop, calls tools, reads their results, and manages sign-in and plan limits. Its own permission prompts are off. It runs on the partner's own Mac login. Other providers go through the same driver interface after approval. The prepaid backup is an existing engine runner for eligible work.
- **Driver interface.** A passive check reports provider, readiness, models and efforts, and any plan reset. A run receives mode, selected model and effort, deadline, role or job instructions, and typed claim data. Chat also gets the claim-scoped DoctorCRE MCP connection and a path to ask Doc for approval before an action runs. The driver returns `answered`, `failed`, `signed_out`, or `plan_limited` with the reset when known. Doc link owns queueing and completion. Results use the same engine contract across drivers. [Setup](setup.md) · [Flows](flows.md)

The role tells Doc to use DoctorCRE tools for app facts, resolve the exact record, ask about missing or ambiguous evidence, and describe the next action. Questions, history, mail, files, and tool output travel as data distinct from the role. The engine can check Doc's tools and returned answer. Doc owns approvals for chat actions. It checks standing grants before dispatch and asks in Ask Doc when an action needs approval. Every driver must provide a way to stop an action before dispatch. A result check happens too late to prevent an action. The pending decision on tool-less mail is in [Q2](questions.md#q2-unattended-mail).

## Read the drawing

| Page                              | What it covers                                                            |
| --------------------------------- | ------------------------------------------------------------------------- |
| [Current state](current-state.md) | What is on main, what is in review, and how both differ from the drawing  |
| [Flows](flows.md)                 | Numbered steps, saved state, and exits                                    |
| [Tools](tools.md)                 | Inputs, outputs, engine doors, and confirmation for DoctorCRE work        |
| [Playbooks](playbooks.md)         | The first workflows and how Doc queries their approved notes and guidance |
| [Setup](setup.md)                 | Joe's Studio, Dell's Mac, future accounts, and the Ask Doc picker         |
| [Memory](memory.md)               | Team preferences and personal preferences                                 |
| [Verification](verification.md)   | Hermetic tests, expected results, and staging checks                      |
| [Decisions](decisions.md)         | Sources and reasons for the drawing                                       |
| [Questions](questions.md)         | Applied defaults and owner choices still open                             |
| [Slices](slices.md)               | Build order, dependencies, and acceptance references                      |
