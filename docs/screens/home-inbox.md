# Home

Home answers three questions on one screen, left to right: what do I have to do, what needs my answer, and how do the day and the deals stand. Check each line on a computer and a phone against a practice copy. The examples use made-up names.

## Layout

- [ ] On a computer Home is three columns under the top bar. Left: **Reminders**. Middle: **Inbox**, with **In motion and waiting** under it. Right: **Today's meetings**, **Deals**, **Coming up** and **Leads**, top to bottom.
- [ ] The page never scrolls on a computer. A tile with more rows than fit scrolls inside itself. At 1440x900 and 1280x640 every tile's heading is in view.
- [ ] On a short screen the Deals tile folds its attention list to one line ("5 need attention") and Coming up folds to one line ("4 dates in the next 14 days"). Each folded line opens what it counts.
- [ ] On a phone the tiles are one column and the page scrolls, in this order: Today's meetings, Reminders, Inbox, Deals, Coming up, Leads, In motion and waiting. Reminders shows its first rows and **See all** with the count. Text is 16px and touch targets are 44px.
- [ ] Home has no right panel, hero, greeting, date banner, explainer text, Mail priorities, Refresh inbox, Search inbox, **Done today** or **Earlier completions**. Finished work stays openable from its record's history with any Undo still available there.
- [ ] Each tile heading shows its count. A tile with nothing in it is not drawn, and the other tiles take its space.
- [ ] Rows, not cards. Tiles are a slightly lighter surface with no outline. Body text is 14px and captions 12px on a computer. Color marks only late (red text), flagged (amber dot) and new leads (blue dot). See [design principles](../design-principles.md).

## Reminders

Things the partner has to go and do on a deal or a vendor.

- [ ] Reminders holds the partner's open deal and vendor next steps, call follow-ups and checklist reminders that are late, due today or have no date. Future steps and automatic check-ins first appear on their due day.
- [ ] Rows sit under **Late**, **Today** and **No date**. An empty group is not drawn. The heading reads "Reminders 13 · 3 late".
- [ ] Each row is two lines. Line one is the action ("Call Dr. Lane with the second tour times"). Line two is the deal or vendor and the reason ("Example Dental · She asked for Thursday afternoon"). The right edge says "3 days late" in Central calendar days, or "Today".
- [ ] The circle on the left marks the step done. **Snooze** and **Drop** show when the pointer or keyboard focus is on the row, and always on touch screens. Clicking the row opens the step beside the list.
- [ ] Reminders more than two weeks late fold into one line at the bottom, "3 more than two weeks late". They stay open, and one click shows them in place.
- [ ] A nightly checklist reminder first appears when the deal owner's [morning window](../new-database.md#deal-watches-and-nightly-checklist-reminders) opens.
- [ ] Home reminders, Today, and Calendar include steps on deals, buildings, parties with a vendor role, and people at one or more current vendor companies. A vendor qualifies even when the party or one of the person's companies also has a lead role. A company link is current if its start is unknown or on or before today's Central date and its end is absent or after today. Lead-only steps open from the lead on [Leads](leads.md), with the follow-up attention badge when late.

## Inbox

What the assistant could not settle alone. The goal is zero.

- [ ] Inbox holds every decision in [What opens and what finishes it](#what-opens-and-what-finishes-it) that is not a step to do: a reply draft or failed delivery, suggestions from a call, meeting or email, a step that may be done, a lease fact, a tour comment or shortlist change, and a meeting outcome. An outstanding meeting outcome from an earlier day is here too.
- [ ] Each row says the decision ("Send your reply to Dr. Lane") and the fact needed to make it ("Draft says Thursday at 2:00 works").
- [ ] Each row has one **Review** button in the same place. It opens the item beside the list.
- [ ] When the Inbox is empty the tile is not drawn and In motion and waiting takes the column.

## In motion and waiting

- [ ] One line per item: what it is and what it waits for, such as "Reply to Sam Reed is sending · Checking Sent" or "Send the parking study · Snoozed until Dec 1". It shows work still being processed, held or snoozed.
- [ ] A snoozed item offers **Wake**.

## Today's meetings

- [ ] The tile shows the current Central day's meetings and planned tours in time order, with a line at the current time. Tours have no hour and sit first, marked **Tour**. Ended meetings stay through the end of the day, dimmed and marked **Ended**, even after a partner answers their review.
- [ ] The tile title and its **Calendar** link open Calendar on today.
- [ ] Each occurrence is identified by its Outlook event key, so separate invites with the same title and time each show. A meeting row opens its attendees, location and deal link when available. If Outlook supplies an outcome review for a meeting in the tile, it is reviewed in the Inbox.
- [ ] A stale calendar shows the last successful sync time.

  Full details for ended meetings depend on the Outlook publisher sending their calendar rows. While it sends only a review for an ended meeting, the tile can show the title and times from that review. [Outlook publisher change](https://github.com/DoctorCRE/carr-system/issues/3265)

## Deals

- [ ] The heading reads "Deals 38 open · 9 prospects". **Board** opens the Deals board.
- [ ] The seven phases follow, each with its count of open deals, in board column order. A phase opens the board at that column.
- [ ] **Needs attention** lists by name the deals that carry the board's Needs attention badge, with its reason, such as "Step 3 days late" or "Flagged". Each name opens the deal page.
- [ ] "7 have no next step" opens the Deals list showing Missing next step.
- [ ] **Monday review** shows this week's progress, "31 of 47", and opens the review.
- [ ] Every number matches what the Deals board, Deals list and Monday review show at the same moment. See [Deals](deals.md).

## Coming up

- [ ] Open critical dates on open deals in the next 14 days, soonest first. Each row reads "Fri, Nov 27 · Due diligence ends · Example Dental".
- [ ] A row opens Calendar on that day. The dates match Calendar. See [Calendar](calendar.md).

## Leads

- [ ] One line, such as "3 new from email · 2 follow-ups late", opens Leads. The counts match the **New from email** and **Follow-up late** badges on Leads. Home shows no lead cards. The line is not drawn when both counts are zero.

## Opening an item

- [ ] Clicking a Reminders or Inbox row opens it over the middle and right columns. Reminders stays in view. Close returns to the three columns.
- [ ] The pane heading is the row's action, with "1 of 5" and **Next**. **Next** opens the following item in the same tile, so a partner can clear the Inbox without going back and forth.
- [ ] **Send reply** is the only orange button on the screen.
- [ ] On a phone the item opens full screen, and Back returns to the same scroll position.

## Refresh and failures

- [ ] Home checks for changes on its existing one-minute schedule while visible and online. A scheduled refresh adds new rows and removes finished rows in place. Existing rows keep their identity and relative order. The refresh preserves scroll position, keyboard focus, the open item, and unsaved edits. If an open item finishes elsewhere, the pane reports that it finished and **Next** moves on.
- [ ] If a read fails, its tile reports which information is unavailable and keeps the last successful view when one exists. One tile's failure leaves the other tiles usable.

## Every item

- [ ] Show each step, Outlook conversation, recorded call, or recorded meeting once. Match by recorded source and target. Without a conversation ID, use the exact stored email. Two distinct steps with the same wording remain separate.
- [ ] Copies of one open step show as one row that lists what it covers, newest first. Copies have the same owner, identical stored wording and the same Home state: due date, snooze, hold, waiting reason. A step under completion review is never a copy. Copies are on the same deal, person, company or building whatever their origin, or came from suggestions accepted on the same meeting record. A meeting's copies on several records are headed "Follow up on the Oct 27 meeting" with the instruction below it, and the row names each person. Each covered step keeps its own finish. Steps the meeting follow-up job or a partner wrote on different records stay separate even with the same wording, since no meeting is recorded on them. Two people with the same name stay separate.
- [ ] A step uses its saved title when it has one. Otherwise use the whole instruction after display cleanup if it fits within 90 visible characters. When the instruction does not fit, the heading is the instruction cut at the last whole word that fits, ending in "…". A blank instruction reads "Next step". An automatic check-in saved in the old cadence wording, a Relationship, Nurture or Periodic touch such as "Relationship touch — Example Supply (V-EXS-001). 90-day vendor cadence.", reads "Check in with Example Supply (vendor)". A name that is only an old record code reads as that record's name, or "an old record". When the name is a company, then a person with a code, the company names the check-in. The person, with the code named, becomes the instruction, and so does any note after the cadence. Home, Today, Calendar, the deal page, the Deals board and List, a prospect's follow-ups, held steps, Doc, the Relationships step and recent activity read check-ins this way. A prospect's follow-up keeps its stored wording for the follow-up editor and returns the check-in wording beside it. Other wording ending in "touch", such as "Final touch: add photos", reads as written. The heading is never the record name. Show the full instruction below the heading when it differs from the heading. Keep phone numbers, link destinations, and meeting details in the instruction. A link with balanced parentheses keeps its entire destination. If a link is unclear, display the stored instruction verbatim.
- [ ] A pending decision uses the title for its kind and the recorded name, such as "Choose the deal for Maya's email". Put the saved summary, instruction, or feedback in the why line so a partner can decide what to do.
- [ ] Mail sent by either partner never asks either partner which deal or vendor it belongs to, whichever mailbox it is in. It is still queued for automatic filing. A partner's addresses are their stored contact addresses.
- [ ] A row shows its due date once. The why line does not repeat it.
- [ ] Click or press Enter on a row to open the exact email, record, or review beside the list. Dates use Central time and read as words. Keep internal codes, schedule offsets, status prefixes, raw timestamps, and Markdown out of display text when it can be cleaned up reliably. Preserve the saved evidence.
- [ ] Put the action that finishes or opens the review in the same place on every row. Offer **Snooze** and **Drop** where supported, on the row on hover and inside the open item. Snooze sets a return time. Drop requires a reason. **Reject** with a reason finishes a lease fact review. Home has no Hide or set-waiting-person control.
- [ ] A successful finish removes the row immediately. Finishes elsewhere take effect on the next refresh. Show a temporary Undo after a save that supports it. Undo brings back the exact row. Once a reply is sent or a suggestion is decided, the action is final.
- [ ] Home has no row checkboxes and no batch snooze. Each row snoozes on its own.

## What opens and what finishes it

| Item                                     | Open                                                                                                                                                                                                                                               | Finish                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deal or vendor follow-up                 | Open the exact next step with the recorded source, setter, and date. A call follow-up opens the call and its evidence. A building-only step links to its sole open deal when available. Otherwise show the saved step and building details inline. | The circle on the row, **Mark done**, finishes the underlying step.                                                                                                                                                                                                                                                                                                                                      |
| Call, meeting, or email with suggestions | Open the source and remaining decisions. Each distinct decision shows once, with its evidence and destination. A next-step proposal allows edits to the words and date.                                                                            | **Accept** saves the proposal. **Drop** records the reason. A filing suggested on several messages is one decision, settled for each. Next steps suggested in one email thread, call, or meeting for the same person and owner are one decision too. Home shows the newest, and accepting or dropping it settles the older ones as replaced or dropped. The group leaves when each decision is finished. |
| Step that may be done                    | Open the exact step and the evidence that it may be finished.                                                                                                                                                                                      | **Yes, it's done** finishes the step. **Not yet** keeps the step open. Either choice finishes the review.                                                                                                                                                                                                                                                                                                |
| Checklist reminder or lease fact         | Open the saved checklist item or the proposed value with its document, pages, and quote.                                                                                                                                                           | Finish the checklist item or drop the reminder. **Approve**, **Correct**, or **Reject** finishes the lease fact review with a reason.                                                                                                                                                                                                                                                                    |
| Tour comment or shortlist change         | Open the property and the saved comment or change with its date.                                                                                                                                                                                   | **Done** closes the review and preserves the feedback.                                                                                                                                                                                                                                                                                                                                                   |
| Meeting outcome                          | Open the scheduled meeting.                                                                                                                                                                                                                        | **It happened** logs the meeting once. **Dismiss** closes the question. An Outlook end time alone does not log it.                                                                                                                                                                                                                                                                                       |
| Reply draft or failed delivery           | Open the exact draft and the source conversation. See the reply review below.                                                                                                                                                                      | **Send reply** approves the exact draft once. **Retry** is available only when the outbox knows nothing went out. **Drop** with a reason takes a reply that failed for good off Home.                                                                                                                                                                                                                    |

Home shows call evidence to both partners. When the other partner receives an assigned follow-up, its row opens the step. Assigned suggestions and completion reviews show their step wording and keep their decision controls.

Use the existing step saves in door 18, suggestion decisions in door 21, reply delivery in door 22, and Home marks in door 24. A pending draft leads its conversation row. Any pending suggestions stay reviewable on that row. When the draft stops being pending, the next decision leads the row with any delivery state still available. While delivery is uncertain, show it in **In motion and waiting** as the system checks Sent. A newer draft or a recorded Outlook reply retires a superseded draft.

## Email and reply review

- [ ] A link to a draft opens that draft even when another reply leads the conversation row. A suggestion link opens its Home row. Both show the pending decisions for the conversation. If the linked review has finished, show its recorded disposition and any saved reason. Links to another partner's work are unavailable.
- [ ] An older filing link opens the current row when a newer email carries the same pending decision. A linked item in **In motion and waiting** is read-only and shows what it is waiting for, such as "Snoozed until Nov 4, 2026, 10:00 AM". Close returns to the three columns, where a snoozed item offers **Wake**.
- [ ] The email row uses the saved action title and summary from the exact message behind the pending draft or leading decision. Show the number of decisions when more than one remains. While the summary is queued, or when the saved result has no grounded action, use the title for the pending decision and show the saved request, summary or recorded facts in the why line. The subject is available in the source view.
- [ ] Opening an email, draft, or email suggestion shows the source thread once. Each message from the signed-in partner's mailbox appears once as "From Maya · Nov 2", even when a draft and a suggestion point to different copies. Show the text that person wrote, with its paragraphs, inline answers, and postscripts. When there is earlier text, **Show earlier text** reveals reply headers, quoted history, signatures, footers, and banners for that message. A trailing signature goes under **Show earlier text** only when a sign-off line is followed by the name and then only name, title, company, address, phone, email and web lines, with at least one phone, email or web address. The sign-off and name stay visible. Any sentence after the sign-off, such as a postscript, keeps the whole block as written. A message with only earlier text still has its sender, date, and disclosure control. Older messages that could not be recovered from Outlook use the existing cleanup and keep some text when their saved body is nonempty. See [Authored text in Home email](../new-database.md#authored-text-in-home-email).
- [ ] The reply review shows one draft with **Edit** and **Talk to Doc about this draft**. The draft area contains the draft, its To and CC, and the send controls. An automatic draft starts with `Re: ` followed by the source email's subject. The partner can edit the draft subject before sending.
- [ ] When a reply's recipients were refused (`submission_recipients_invalid`), the row says "Didn't send. The recipients were refused. Correct them and send again." The review fills **To** and **CC** with the saved addresses. The partner can correct them and press **Send reply** again. Any other final failure says "Reply from Outlook".
- [ ] Doc's status ("Doc isn't set up on your Mac yet." and its other states) sits in its own row under the draft, beside a disabled **Talk to Doc about this draft** and read as that button's description. It is not in the Edit, Drop and Send reply row.
- [ ] A reply review shows every next-step suggestion on the email, each with its own **Accept** and a way to drop it. The app hides none. A due date in the past shows "Already late. Due Nov 1." under the date field, and the note follows the date the partner sees, including one just edited.
- [ ] A possible new deal row with no saved reason names the sender (the proposal's target, else the source email's sender) and shows the first line of its evidence, up to 160 characters. That line skips header lines (From, To, Cc, Sent, Date, Subject), greetings such as "Hi Maya,", "On ... wrote:" lines and leading `>` quote marks.
- [ ] **Edit** opens the pending draft for manual changes. **Talk to Doc about this draft** opens a conversation with its exact draft and email. Doc proposes revised text. **Save revision** applies the confirmed text to that same pending draft at the version Doc reviewed. Return to the same review with the revised text. The partner still presses **Send reply** to send it. If the draft changed or is no longer pending, show that in the review and preserve any unsaved text. See [Doc](doc.md).

## Work the engine handles

- [ ] A clear inbound lead goes straight to Leads as an unclaimed lead with its source email and **New from email** badge. Repeated lead-source notices about the same verified prospect keep one lead with its distinct evidence. See [Leads](leads.md).
- [ ] When a stored lead-source notice moves to Leads, its pending filing decisions finish with **Moved to Leads** in their history. The conversation keeps its reply drafts, other decisions, and filings for other messages.
- [ ] The engine files mail when saved evidence identifies the destination, such as a known thread tied to one deal. When filing judgment is enabled, a job on the mailbox partner's link saves relevant facts on each verified deal or vendor. The engine checks the sender's vendor affiliation on the date the email was sent. Each saved fact keeps its source email. A partner's filing or dismissal closes the email's pending filing reviews in both mailboxes. A new correction from the mail router stays reviewable. A prior unlink stays in effect, and an independent reply or suggestion still has its review. When a job cannot resolve the filing, Home keeps the existing filing review or shows **Review where to file this email**. The review offers **Choose deal** and **Choose vendor** when those destinations apply. The partner can ask Doc for help with it.
- [ ] Choosing a deal checks that deal before enabling **File email**. If the email is already filed to another deal or the selected deal's client isn't linked to the email, show the reason the engine gives and require a short explanation. If the requirement changes before the save, keep the selected deal and prompt for the reason beside the field.
- [ ] Routine schedule bookkeeping, informational deal updates, and work with a recorded completion stay with their record. An unfinished checklist reminder or distinct proposed call note can still need a partner. A scheduled check-in can ask the partner to contact someone on the due day.

Today's engine reads steps, marks, suggestions, drafts, and meetings. It saves email summaries and can already file a link when routing evidence identifies one eligible deal. The tiles, filtering, and clean thread use stored records and require no model. The Deals, Coming up and Leads tiles use the same reads as the Deals board, Monday review, Calendar and Leads. The review reads use the same display entry for each message across a partner's reviews. They use the stored authored text and history when available. Jobs that need judgment, such as writing summaries or choosing facts to file, use the mailbox partner's Doc link first under decision 195. Decision 196 provides for prepaid Claude backup when the link is unavailable. Talking to Doc from a reply also needs [Doc in the app](https://github.com/DoctorCRE/doctorcre-engine/issues/955). See the [engine contracts](../new-database.md#home-inbox-reads-for-the-app).
