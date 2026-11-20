# Home inbox

- **For** each partner, signed in, on a computer or a phone. Each sees their own work and can look at the other partner's.
- **Must** show every real thing that needs the partner once, open each to what it is, let the partner finish it from Home, and stay current by itself.
- **Must never** repeat work, show a card that cannot be opened or finished, or display internal codes or raw timestamps. Only a partner can approve a reply or decide a suggestion. The engine handles routine work as described below and records it under the job that did it.

The owner's test, in his words: "each real thing shows once, every card opens to what it is, every card can be finished, and it stays current without you cleaning it up." Each checkbox line is checked on the real screen, signed in, against a copy of production. Examples use made-up names.

## Every card

- [ ] Show each saved step, email conversation, call or meeting once. See all expands the same list. A reminder or priority shortcut points to its existing card.
- [ ] Match copies of the same work by their recorded source and target. Two steps with the same words stay separate when they belong to different people, records or events. Cancel a redundant copied step with a recorded reason only after confirming it came from the same work. If the source is unknown and the action is clear, keep the step and show the recorded person, deal, property or date that distinguishes it.
- [ ] Each card asking for work says "<what happened> — <what to do>". The title names the person, deal or property and the action. One line underneath says why the action is needed. The partner can understand it without opening the source.
- [ ] The title describes the primary button's action. Clicking the title opens the context. The review can offer the choices that finish it. A waiting or Done card says what is happening or what happened and has no action to finish it.
- [ ] For email, use the saved current email summary to explain the request. Keep the subject in the source view. When the summary is missing, use an explicit saved request or a literal stored quote that explains the action. If neither supplies the fact, the card needs a summary. Save one from the stored message before writing a title that depends on it. Until then, identify the sender and the known decision, with "Email summary unavailable" on the why line. Use the recorded sender name, then the sole exact directory match, then the address.
- [ ] Show the client, lead, vendor or deal by name when known. The title can supply that name. "No linked deal" never shows on a card that belongs to a person or company.
- [ ] Dates read as words in Central time: "Due Thu, Nov 19", "2 days late", "Today 12:00 PM". Never `2026-11-19` or `2026-11-02T15:41:50.000Z`.
- [ ] Titles, why lines and review text use record names and dates in words. Omit internal client, lead and vendor codes, loop numbers, schedule-rule names, offset labels such as "T-3 months", and markdown markers. Preserve the saved evidence. A lease reminder uses the recorded date and action, such as "Cedar Suite reaches its lease decision date in March — confirm renewal plans". A missing action or date stays unknown until the step is corrected.
- [ ] Clicking the title opens what the card is about, as each kind below says. Opening never just outlines the same card in the list.
- [ ] A card waiting on the partner has its finishing button in the same place, named for what it does, with Snooze beside it. Reply drafts and suggestion groups put their review action in that position and open the decision there. A card in In motion and waiting asks for nothing and has neither, except that a snoozed card offers Wake (coordinator, 2026-11-20).
- [ ] Finished work leaves the active inbox at once. A Done card opens the saved work. It offers Undo only when the signed-in partner can reverse their own current step completion. A sent reply or a completed suggestion review has no Undo. Tour feedback offers Undo after the partner marks it done. An automatically closed step has its own Undo under Closed automatically when available.
- [ ] Work finished anywhere else (deal page, assistant, call capture, the other partner, Outlook) leaves Home on the next refresh without a click.
- [ ] Snooze offers plain choices in Central time and brings the card back then. Undo brings it back at once.
- [ ] Refresh inbox reloads the cards. The line beside it says whether Home is current, updating, or offline.
- [ ] Each card has a checkbox. With cards selected, Home shows how many, Snooze selected and Clear selection. After a batch it lists each card's result, with Undo whole batch, Undo selected results, Retry same batch when a result is uncertain, and Finish reviewing batch.
- [ ] Home has no "set waiting person" control.
- [ ] Home has no Hide. Every card is finished, snoozed to a date, or dropped with a reason. There is no "Hide from inbox", no "Hidden from inbox" list, and no Hide button on the selection bar (today "Settle selected") (owner, 2026-11-19).
- [ ] Every live card hidden before Hide went is back in the inbox. Of the 11 old hidden marks, 5 come back as inbox cards, and the other 6 have no live card (one cancelled step and five notifications with no copied card) (coordinator, 2026-11-19).
- [ ] Each active kind with Snooze has Drop beside it. Drop asks for a reason, and the card leaves. Steps, call follow-ups, checklist reminders, reply drafts, suggestions and tour feedback offer these actions. A lease fact is the one exception: its Reject asks a reason and finishes the card, and it has no separate Drop (coordinator, 2026-11-19).

When app routing moves to the new database, Home uses door 24 for `snooze` and `unsnooze` (wake and Undo) on steps, call follow-ups, updates, suggestions and reply drafts, `drop` with a nonblank reason on call follow-ups, updates and tour feedback, and `done` and `undo_done` on tour feedback. Door 24 has no `settle` or `unsettle`, and the Home read has no settled shelf and advertises `home_mark_drop: true` and `home_proposal_drop: true`. Door 18 handles Mark done, reopening and cancelling steps with a reason. Door 21 handles suggestion decisions, including completion reviews and reason-bearing dismissal for every suggestion kind (see `docs/new-database.md`).

## Inbox sections

- [ ] Late: the partner's steps dated before today, each saying how late, such as "3 days late". Home never says "Overdue" (coordinator, 2026-11-19).
- [ ] Needs your attention: everything else waiting on the partner today.
- [ ] Today: steps dated today.
- [ ] In motion and waiting: calls still being read, cards on hold, snoozed cards, each saying when it comes back.
- [ ] Done today, then earlier completions, each with the time it was done in words.
- [ ] Search finds cards by title and by the name of the client, lead, vendor or deal.
- [ ] A step dated after today, such as an automatic check-in months ahead, stays off Home until its day. Home has no "Coming up" list (owner, 2026-11-19).

## Card kinds that need a partner

Each row gives an example title, the source of its why line, and the single primary action. Use recorded facts in place of the examples.

| Card                             | Example title                                                             | One-line why                                                                                                                                                                                                              | Primary action      |
| -------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Step                             | Follow-up due for Example Dental — call about the suite                   | The saved reason or source, with the due date or creator when known. When the record lacks an explanation, say no reason was recorded.                                                                                    | Mark done           |
| Call follow-up                   | Call with Dr. Example left a follow-up — send the floor plan              | The call's saved evidence quote or summary and date.                                                                                                                                                                      | Mark done           |
| Call or meeting with suggestions | Call with Dr. Example — review the move to Negotiating                    | Give the recorded next step or decision driving the review. Use the call or meeting summary or its evidence. For a meeting, name that meeting instead of the call. Use the date and deal if the person's name is unknown. | Review suggestions  |
| Reply draft                      | Dr. Example asked for tour times — review reply                           | The saved email summary says which property and when they want to tour.                                                                                                                                                   | Review reply        |
| Reply that failed                | Reply to Dr. Example didn't send — review delivery                        | Give the saved failure reason in plain words.                                                                                                                                                                             | Review delivery     |
| Step that may be done            | A call mentions the lease draft — confirm whether it was sent             | The saved quote or summary that suggests this specific step happened.                                                                                                                                                     | Review completion   |
| Checklist reminder               | Lease review is due for Example Dental — check the lease                  | The saved checklist item and its due date.                                                                                                                                                                                | Open checklist item |
| Lease fact to check              | Lease draft lists base rent for Example Dental — verify the amount        | The document and page that supplied the value.                                                                                                                                                                            | Review lease fact   |
| Tour comment                     | Example Dental commented on Cedar Suite — review feedback                 | The saved comment in one line. When only the change notice was saved, use its recorded wording.                                                                                                                           | Review feedback     |
| Shortlist addition               | Example Dental added Cedar Suite to the shortlist — review the change     | The saved property and when it was added.                                                                                                                                                                                 | Review feedback     |
| Shortlist removal                | Example Dental removed Cedar Suite from the shortlist — review the change | The saved property and when it was removed.                                                                                                                                                                               | Review feedback     |
| Meeting outcome                  | Site tour with Example Dental was scheduled today — confirm it happened   | The scheduled time and known attendees or deal from Outlook.                                                                                                                                                              | Review meeting      |

- [ ] A step opens to the saved action and its creation details when available. On a deal, open `/deals?deal={deal_id}&focus=next-step&step={next_step_id}`. For a prospect, open its follow-up on Deals. For another person or company, open its Relationships node. A building-only step opens its sole open deal when there is one. Otherwise open the saved step and its building details inline. Mark done finishes the exact step. Undo reopens the partner's own current completion.
- [ ] An undated open follow-up stays on Home. Use a follow-up title when the creator or source is known. When the record lacks context, use the saved wording cleaned for display and say that no reason was recorded. Leave the due date blank.
- [ ] A call follow-up opens the source call, its date and evidence, and the deal. Mark done and Undo act on the underlying step once.
- [ ] A pending call or meeting group opens its recording or notes and every remaining decision. Accept saves a suggestion. Drop asks for a reason. The group leaves when all decisions are finished. A recorded call still being read asks for no action while it is in motion.
- [ ] Review reply opens the source and the exact draft with To and CC. Save draft saves edits. Send reply approves that text once from the partner's mailbox. Sending asks for no action. Sent appears once in Done at the recorded send time. There is no Undo for sending. A newer draft or a reply recorded from Outlook retires the superseded draft.
- [ ] Review delivery offers Retry only when the outbox knows nothing went out. A possible send stays in motion while the system checks Sent. If the outbox cannot retry, the review directs the partner to Outlook.
- [ ] Review completion opens the exact step and its evidence. Yes, it's done completes it. Not yet keeps it open. The review leaves after either decision. Snooze returns it if still pending. A step closed automatically keeps its seven-day Undo where available under Closed automatically.
- [ ] Open checklist item goes to the saved item. The reminder leaves when the item is finished or dropped with a reason. Routine updates follow the rule below.
- [ ] Review lease fact opens the proposed value, document, pages and quote. Approve, Correct or Reject save a reason and finish the card. Reject serves as Drop. This is an app review kind while its Home source is still on the old read.
- [ ] Review feedback opens the saved property, comment or shortlist change and its date. Done closes the review and preserves the saved feedback and shortlist. Undo brings the card back.
- [ ] Review meeting opens the scheduled meeting. It happened logs it once. Dismiss drops the question. Outlook's scheduled end alone does not confirm that the meeting happened.

### Suggestions on a card

- [ ] Use one card per Outlook conversation, recorded call or recorded meeting. Without a conversation ID, match the exact stored email. Distinct messages with the same subject can ask for different work. Give each retained decision its own context and source date. Repeated proposals for the same action on the same source and target appear once.
- [ ] A suggestion title still names the decision when it is late. "N days late" supplies timing next to the card's date. The one-line why explains the work.
- [ ] A pending draft leads its conversation card. An approved or failed draft shares an existing suggestion card, with its delivery state available in the review. Otherwise one remaining decision leads the title and why line. If several decisions remain, use the first decision in review order for the context and say how many decisions to review. Use the source for the decision named on the card, even when a newer message is in the conversation. Mail priorities only orders existing cards.
- [ ] The card's review shows each proposal with its evidence and destination. Partners can accept or drop each one. A next step's words and date can be edited before saving. Drop requires a reason. Neither choice has Undo.

| Suggestion                                | Example title when it leads an email card                           | One-line why                                                                                             | Primary action      |
| ----------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------- |
| Next step                                 | Dr. Example asked for the floor plan — review the follow-up         | Email summary or saved request, plus the proposed step. For calls and meetings use their saved evidence. | Review follow-up    |
| Uncertain email filing                    | Dr. Example sent lease terms — choose the deal                      | Email summary or quote and the known reason the deal could not be matched.                               | Choose deal         |
| Possible new deal                         | Dr. Example asked about a second location — decide where to file it | Email summary or quote explaining the possible deal.                                                     | Choose deal         |
| Proposed phase change                     | Example Dental received an LOI — review move to Negotiating         | Saved milestone evidence and proposed phase.                                                             | Review phase change |
| New lead role suggested for a known party | Dr. Example expressed interest — review adding a lead               | Saved evidence of interest and the party's name.                                                         | Review lead         |
| Proposed lead-stage change                | Dr. Example replied about timing — review lead stage                | Saved evidence and proposed stage.                                                                       | Review lead stage   |
| Log a call with a distinct suggested note | Example Dental discussed lease timing — review call note            | The saved note and the call evidence. This action only adds a note to the existing record.               | Review call note    |

### Work the engine handles

- [ ] The automatic follow-up schedule checks eligibility, calculates the due date, and sets the next check-in once. Schedule bookkeeping stays with the follow-up record. Existing open steps stay visible on Home while automatic schedule maintenance is pending. If an existing save shows the work was already done, remove the request and keep the completion with the party or deal's history.
- [ ] An automatic check-in that still requires a partner to contact someone or make a business decision appears on its due day. Its title names the person or company and the requested action. The why line gives the recorded reason and date. The schedule never sends outreach or marks it done without evidence.

- [ ] A clear inbound lead goes straight to Leads as an unclaimed lead with its source email and a **New from email** badge. No Home card or Mail priorities row is created for that intake. Repeated lead-source notices about the same verified prospect keep one lead and its distinct source emails. Separate prospects from the same source each get their own lead. See [Leads](leads.md) for what qualifies and how the badge clears.
- [ ] The engine files mail automatically when existing routing evidence identifies exactly one eligible open deal. It respects a partner's earlier unlink and leaves conflicting links for a partner to resolve. The email is visible on the deal's Timeline. An already-filed email needs no filing review. Other pending work in that conversation stays available.
- [ ] An informational deal update stays on the deal's Timeline. Home asks for no acknowledgement. A dated reminder tied to an unfinished checklist item stays actionable.
- [ ] A call already saved is visible in the call record and its linked Timeline. If a suggestion only repeats what is already saved there, Home asks for no second log. A suggestion that would add a distinct note still needs review.
- [ ] Existing automatic actions, such as a closed step or recorded Outlook reply, never become a new request to mark them done. Keep the recorded event and any available Undo in its history.

## Today panel

- [ ] Shows today's meetings and the partner's dated reminders, with a choice of both partners or either one. Meetings after today stay in Outlook and do not show on Home (coordinator, 2026-11-19).
- [ ] Does not repeat a step that is already a card in the inbox. A reminder with a card brings that card into view and opens its inline review when it has one.
- [ ] Each section either shows its items or says plainly why it cannot. It never stays on "Checking…".
- [ ] A reminder dated before today is listed under "Late" and says how late, such as "3 days late", as the deal's next step does. The panel never says "Overdue" (coordinator, 2026-11-19).
- [ ] With `home-from-engine` on, every page that uses the shared side frame shows Home's engine Today panel for today's meetings and the partners' dated reminders. This replaces Your calendar, Upcoming meetings, Your working week, Your schedule, and Doc's Morning brief (coordinator, 2026-11-20).

## Mail priorities

- With the Home read switched to the new database, the engine supplies one priority row per Outlook conversation. Each row links to its matching Home card and its source email.
- An email without an Outlook conversation ID is its own group, keyed by its source email ID.
- The panel orders up to 25 inbox cards and indicates when more qualify. The remaining conversations stay in the inbox, with no next page in the panel.
- [ ] Mail priorities moves matching cards to the front of their inbox sections. Partners open the existing cards to review the email and its suggestions.
- [ ] Email cards show the source email's date in words so distinct emails with the same sender and subject can be told apart.
- [ ] No coverage line in system words, such as "Mailbox Example · Recorded inbound pending proposals".
- [ ] Each email shows once on Home, as its inbox card. Mail priorities only orders those cards and shows no email of its own (owner, 2026-11-19).

## Meetings

- [ ] Each meeting shows once, in the Today panel. Home has no Upcoming meetings, Your working week or Your schedule panel (owner, 2026-11-19).
- [ ] Each meeting shows its time in words, its title, and the client or deal it is about.
- [ ] Opens to the meeting with its attendees, and to its deal when it has one.
- [ ] After a meeting ends, Today shows its meeting outcome review once when Outlook supplies one.
- [ ] When Home's calendar may differ from Outlook, it says when it last matched.

## Not yet true

Baseline from the 2026-11-18 walkthrough and app code. The new card titles, why lines, automatic filing rules and Leads badge above describe the target behavior.

- The prospect and Relationships views still lack the step's recorded creation details.
- Step titles carry internal codes, loop numbers, cadence names and markdown asterisks.
- Steps for a client, lead or vendor say "No linked deal".
- Due dates show as `2026-10-01`. Mail priorities shows UTC timestamps and "Recorded overdue".
- Every card carries a "needs attention" badge and "Ready for your attention". The inbox says "91 matching loaded cards of 91 loaded" and "Partner inbox".
- Steps due in 2027, and one on hold until 2027, sit in Needs your attention.
- Mail priorities rows are titled only "Next step", "Email filing" or "Possible new deal", with no sender or subject, and almost all link to the same email follow-ups page.
- Mail shows both in Mail priorities and as inbox cards.
- The app still reads Home from CARR. The engine read supplies draft and suggestion cards with their source and target IDs, marks and sent draft history. Opening the email and deciding a suggestion from Home still need app routing.
- The reply review shows the draft but not the email it answers. A failed reply asks the partner to send it from Outlook, then press Hide.
- Home still offers Hide from inbox, the Hidden from inbox list and the selection bar's Settle selected.
- No card has Drop with a reason on the live CARR-backed screen. The engine now supplies reasoned Drop for every Home card kind (doors 18, 21, 22 and 24) and tour feedback Done/Undo (door 24); app routing still waits.
- The inbox's past-due section is titled "Overdue" (code).
- One overdue step shows both under Hidden from inbox and in the Today panel's Overdue list.
- The Today panel calls a past-due reminder "overdue" and its Deal pulse stayed on "Checking recent deal changes…" on the live CARR-backed screen. The engine now supplies `GET /api/engine/home/today` with today's meetings from door 25 and partner-scoped dated reminders (with Home card links and `N days late`, and no Deal pulse); app routing still waits.
- Today's vendor lunch shows in Upcoming meetings, Your working week and Your schedule.
- Overdue steps to confirm ("Overdue tasks to review") did not appear on Home. The engine read can return completion reviews with a link to the deal's next step. Home still needs to route the read and wire the decision buttons.
- The engine still reads informational updates as Home notices. The new behavior keeps these in the deal Timeline and retains reminders for unfinished checklist items.
- A card with no page to open and no finishing button says "Read it, then hide it from your inbox." (code).
- Tour feedback cards on Home have no review and no finishing button. Only an action link's page opens the feedback, and it only shows it (code).
