# Home inbox

- **For** each partner, signed in, on a computer or a phone. Each sees their own work and can look at the other partner's.
- **Must** show every real thing that needs the partner once, open each to what it is, let the partner finish it from Home, and stay current by itself.
- **Must never** show the same thing twice, a card that cannot be opened or finished, an internal code, a raw timestamp or a system word; never send mail or decide a suggestion without the partner's click. What changes by itself, such as a step a call closed or a reply recorded from Outlook, never shows as the partner's click.

The owner's test, in his words: "each real thing shows once, every card opens to what it is, every card can be finished, and it stays current without you cleaning it up." Each checkbox line is checked on the real screen, signed in, against a copy of production. Lines marked **Open** wait on an owner question below and are not checked until he answers. Examples use made-up names.

## Every card

- [ ] One card per real thing: one step, one email conversation, one call, one meeting. Two records about the same thing make one card.
- [ ] The title says what to do in plain words, such as "Call Dr. Example about the second-floor suite".
- [ ] Under the title, the client, lead, vendor or deal it is for, by name. "No linked deal" never shows on a card that belongs to a person or company.
- [ ] Dates read as words in Central time: "Due Thu, Nov 19", "2 days late", "Today 12:00 PM". Never `2026-11-19` or `2026-11-02T15:41:50.000Z`.
- [ ] No internal codes or system words: no `C-159`, `V-BNK-040`, `L-223`, loop numbers, "cadence", "needs attention" badges, "Ready for your attention", "loaded cards" or "Partner inbox". No markdown asterisks.
- [ ] Clicking the title opens what the card is about, as each kind below says. Opening never just outlines the same card in the list.
- [ ] A card waiting on the partner has its finishing button in the same place, named for what it does, with Snooze beside it. A card in In motion and waiting asks for nothing and has neither.
- [ ] A card the partner finishes leaves at once. It shows Undo only where its kind below says so.
- [ ] Work finished anywhere else (deal page, assistant, call capture, the other partner, Outlook) leaves Home on the next refresh without a click.
- [ ] Snooze offers plain choices in Central time and brings the card back then. Undo brings it back at once.
- [ ] Refresh inbox reloads the cards. The line beside it says whether Home is current, updating, or offline.
- [ ] Each card has a checkbox. With cards selected, Home shows how many, Snooze selected and Clear selection. After a batch it lists each card's result, with Undo whole batch, Undo selected results, Retry same batch when a result is uncertain, and Finish reviewing batch.
- [ ] Home has no "set waiting person" control.
- **Open (question 2).** Recommended: Home has no Hide; every card is finished, snoozed to a date, or dropped with a reason, and the selection bar's Hide button (today "Settle selected") goes too. Otherwise Hide from inbox sets a card aside unfinished, and it shows under "Hidden from inbox" with Show in inbox.

When app routing moves to the new database, Home uses door 24 for snooze, settlement and undo on steps, call follow-ups, updates, suggestions and reply drafts. Door 18 handles Mark done and reopening the step. Door 21 handles suggestion decisions, including completion reviews (see `docs/new-database.md`).

## Inbox sections

- [ ] Overdue: the partner's steps dated before today.
- [ ] Needs your attention: everything else waiting on the partner today.
- [ ] Today: steps dated today.
- [ ] In motion and waiting: calls still being read, cards on hold, snoozed cards, each saying when it comes back.
- [ ] Done today, then earlier completions, each with the time it was done in words.
- [ ] Search finds cards by title and by the name of the client, lead, vendor or deal.
- **Open (question 1).** Steps dated after today, such as automatic check-ins months ahead. Recommended: they show only on their day. Otherwise they show in a separate "Coming up" list.

## Card kinds

### Step

A next step the partner owns.

- [ ] Uses the full step text as its title and shows who or what it is for and when it is due.
- [ ] Opens to the deal, client, lead or vendor page with the step in view: who set it, when, and from what (a call, an email, a meeting, or the automatic follow-up schedule).
- [ ] A step about a building alone opens the deal that building is on (owner, 2026-11-18).
- [ ] A prospect's follow-up opens that prospect on Deals with the follow-up in view (`docs/screens/deals.md` § "A prospect"). It reaches Home only once Home reads the new database; the Deals switch alone does not bring it.
- [ ] Mark done finishes the step. Undo reopens it.
- [ ] Leaves when done or dropped anywhere, or when a newer step replaces it for the same person on the same client or deal.

### Call follow-up

A step a recorded call produced.

- [ ] Uses the full step text as its title and shows the deal and "From your call with Dr. Example on Tue, Nov 17".
- [ ] Opens to the call's summary with the part of the call the step came from, and a link to the deal.
- [ ] Mark done and Undo work as on a step. Leaves as a step does.

### Call

A recorded call whose suggestions wait for the partner.

- [ ] While the call is still being read, it sits in In motion and asks for nothing.
- [ ] Then says "Call with Dr. Example, Tue, Nov 17: 3 suggestions".
- [ ] Opens to each suggestion with Accept and Dismiss. Neither has Undo.
- A copied Log a call suggestion uses the reviewer recorded for that suggestion when the source call has no partner stamp.
- [ ] Next steps and phase moves the call made by itself show as made automatically, each with Undo.
- [ ] Leaves when every suggestion is accepted or dismissed.

### Reply draft

A reply Dr. CRE drafted to an email.

- [ ] Says "Reply to Pat Example: Floor plan for suite 200". One card per email conversation.
- [ ] Opens to the email being answered (who wrote, when, what they said), then the draft with To and CC.
- [ ] Save draft sends nothing. Decline asks for a reason, and the card leaves.
- [ ] Send reply approves this exact text to be sent once from the partner's own mailbox. The card shows "Sending" until the outbox records it, then appears once in Done as sent, using the recorded send time. Send reply has no Undo.
- [ ] When the outbox records a failure, the card says "Didn't send" and why, in plain words. If nothing went out, Send reply is offered again. If it may have gone out, the card says it is checking the Sent folder and offers no Send reply. Any other failure is never sent again on its own; the partner answers from Outlook.
- [ ] Leaves by itself, with no click, when the partner's own reply in that conversation is recorded from Outlook, or when a newer email in the conversation brings a newer draft.

### Email suggestion

A next step, a deal to file the email to, a possible new deal, or a deal's progress that an email suggests.

- [ ] Shows the sender and subject as its title, such as "Pat Example · Floor plan". A grouped card uses the latest email among its suggestions.
- [ ] Opens to the email and the deal, client or lead it would change.
- [ ] Accept saves the suggestion, and lets the partner edit a step's words and date first. Dismiss drops it for good. Neither has Undo. Only the partner's click decides, never the assistant.
- [ ] Leaves when accepted or dismissed. One card per email conversation.

### Step that may be done

A note, deal update or call suggests an overdue step already happened.

- [ ] Says "Did this happen? Send the lease draft (Example Dental, Springfield)" with the words that suggest it.
- [ ] Opens to the deal and the note or call it came from.
- [ ] Yes, it's done finishes the step. Not yet keeps it open. Neither has Undo.
- [ ] Snooze puts the step on the snoozed shelf until the chosen time, then the review returns if it is still pending.
- [ ] A step closed automatically shows under "Closed automatically" for seven days, with Undo.
- [ ] Leaves when answered.

### Update

A change on a deal the partner follows.

- [ ] Says the deal and what changed: "Example Dental, Springfield moved to Negotiating".
- [ ] Opens to the deal page at that change.
- [ ] Got it marks it read. Leaves when read.

### Lease fact to check

A lease value read from a document that needs the partner's eye.

- [ ] Says the deal and the fact: "Example Dental: check the base rent".
- [ ] Opens to each value found, with its document, pages and quoted text.
- [ ] Approve, Correct or Reject, each with a reason. Leaves when saved.

### Tour feedback

A client's comment on a toured property, or a property added to or removed from their shortlist.

- [ ] Opens to the property, the comment or the shortlist change, and when it was left.
- **Open (question 4).** Whether tour feedback stays on Home, and which button finishes it.

## Today panel

- [ ] Shows today's meetings and the partner's dated reminders, with a choice of both partners or either one.
- [ ] Does not repeat a step that is already a card in the inbox. A reminder with a card opens that card.
- [ ] Each section either shows its items or says plainly why it cannot. It never stays on "Checking…".

## Mail priorities

- With the Home read switched to the new database, the engine supplies one priority row per Outlook conversation. Each row links to its matching Home card and its source email.
- An email without an Outlook conversation ID is its own group, keyed by its source email ID.
- The panel orders up to 25 inbox cards and indicates when more qualify. The remaining conversations stay in the inbox, with no next page in the panel.
- [ ] Each row names the sender, the subject, what is suggested, and the date in words.
- [ ] Opening a row opens the same thing its inbox card opens.
- [ ] No coverage line in system words, such as "Mailbox Example · Recorded inbound pending proposals".
- **Open (question 3).** Recommended: each email lives once on Home, as an inbox card, and Mail priorities only orders those cards. Otherwise both panels stay as they are.

## Upcoming meetings

- [ ] Each meeting shows its time in words, its title, and the client or deal it is about.
- [ ] Opens to the meeting with its attendees, and to its deal when it has one.
- [ ] After a meeting ends, Home asks once whether it happened. It happened logs it; Dismiss drops the question.
- [ ] When Home's calendar may differ from Outlook, it says when it last matched.
- **Open (question 3).** Recommended: each meeting lives once, in the Today panel. Otherwise Upcoming meetings, Your working week and Your schedule stay as they are.

## Questions for the owner

Questions 1 to 3 are asks 12 to 14 on the roadmap's "What we need from you" list. Question 4 is not on it yet.

1. Automatic check-ins with vendors and clients dated months ahead sit in Needs your attention today. Recommended: they show only on their day. Or they go in a separate "Coming up" list.
2. "Hide from inbox" sets a step aside unfinished. Recommended: remove it, so every card is finished, snoozed to a date, or dropped with a reason. Or keep it.
3. Mail shows in both Mail priorities and the inbox, and today's meetings show in three panels. Recommended: each email lives once, as an inbox card, and Mail priorities only orders those cards; meetings live once, in the Today panel. Or keep the panels as they are.
4. Should tour feedback stay on Home, and if so, what finishes it?

## Not yet true

Seen on the live Home screen on 2026-11-18, or read in the app's Home code where noted.

- Clicking a card's title only outlines the same card. "See details" on a step repeats its title.
- Step titles carry internal codes, loop numbers, cadence names and markdown asterisks.
- Steps for a client, lead or vendor say "No linked deal".
- Due dates show as `2026-10-01`. Mail priorities shows UTC timestamps and "Recorded overdue".
- Every card carries a "needs attention" badge and "Ready for your attention". The inbox says "91 matching loaded cards of 91 loaded" and "Partner inbox".
- Steps due in 2027, and one on hold until 2027, sit in Needs your attention.
- Mail priorities rows are titled only "Next step", "Email filing" or "Possible new deal", with no sender or subject, and almost all link to the same email follow-ups page.
- The app still reads Home from CARR. The engine read supplies draft and suggestion cards with their source and target IDs, marks and sent draft history. Opening the email and deciding a suggestion from Home still need app routing.
- The reply review shows the draft but not the email it answers. A failed reply asks the partner to send it from Outlook, then press Hide.
- One overdue step shows both under Hidden from inbox and in the Today panel's Overdue list.
- Today's vendor lunch shows in Upcoming meetings, Your working week and Your schedule.
- The Today panel's Deal pulse stayed on "Checking recent deal changes…".
- Overdue steps to confirm ("Overdue tasks to review") did not appear on Home. The engine read can return completion reviews with a link to the deal's next step. Home still needs to route the read and wire the decision buttons.
- Update cards offer "Open" and the page the update names, or "Open Updates" when it names none, and never Got it (code). The engine read links each unread Home update to its deal. Home still needs to route the read and wire Got it.
- A card with no page to open and no finishing button says "Read it, then hide it from your inbox." (code).
- Tour feedback cards on Home have no review and no finishing button. Only an action link's page opens the feedback, and it only shows it (code).
