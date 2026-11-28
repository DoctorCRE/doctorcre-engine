# Build slices

Approve the drawing and settle the engine base first. Open one issue per slice with its flow, acceptance cases and expected files. Use up to four lanes with different files. Keep dependent changes together. Engine and app use separate branches and reviews. [Staging trace](verification.md#staging-run-through)

| Slice                              | Lane        | Depends on          | Engine work and proof                                                                                                                                                                                                                |
| ---------------------------------- | ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1 Register models                 | Runner      | #1508               | [Setup](setup.md) steps 1 to 3. Prove a Codex-only install, one link registering both providers, and preservation of a valid link on rerun. Reuse the existing chat and mail probes.                                                 |
| S2 Choose and credit the provider  | Runner      | S1                  | #1507 serves the catalog and saves the chat choices. Prove next-claim selection, fallback and provider attribution. The first sourced answer on Codex-only uses the app picker in the combined trace.                                |
| S3 Approve Doc actions             | Runner      | S2 and Q1–Q2        | F6 adds pre-dispatch checks, scoped grants and replay. Prove expiry, reclaim and revocation before enabling the covered native actions.                                                                                              |
| S4 Follow up on a deal             | Workflows   | #1502 and #1520 S13 | P1 and F1–F4. Use `read_playbook` and `read_guidance` for `deal_follow_up` and the exact deal. Prove notes, scope, citations and pins. Return phase and owner for same-name matches. Compare prose against current facts in staging. |
| S5 Draft or revise the exact reply | Workflows   | S4                  | P2 uses topic `email_reply` and the exact authorized email or pending draft. Prove editable draft, unchanged existing draft, stale revision and separate submission.                                                                 |
| S6 File the exact email            | Workflows   | S5                  | P3 and F10 use topic `email_filing`, exact filing review and preview. Prove only the partner's Home action records the decision.                                                                                                     |
| S7 Remember preferences            | Preferences | Q7                  | F9 adds keys, declared defaults and storage. Prove shared comparison format and isolated draft-length claim input. Verify the approved defaults after delete. The combined trace checks P2 after S5 and S7.                          |

## App prerequisites

The app is [doctorcre-app](https://github.com/jbookout/doctorcre-app). The coordinator names the companion app issues before the corresponding screen checks run.

| Engine slice | Companion app work                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2           | Ask Doc model picker, choice save, attribution and first sourced Codex answer. Use the app issue called for in [#1507](https://github.com/DoctorCRE/doctorcre-engine/issues/1507). |
| S3           | Approval cards in Ask Doc and grant revocation in Settings.                                                                                                                        |
| S4           | Existing record picker and exact chips, plus the deal phase, owner and numbered fallback.                                                                                          |
| S5 and S6    | Exact email handoff from Home and reply review, plus the exact draft or filing review link.                                                                                        |
| S7           | Preference controls in Settings and the Ask Doc confirmation.                                                                                                                      |

Record the engine and app head SHAs deployed together to staging. The combined trace checks that pair. Review each repository's change against the same results.
