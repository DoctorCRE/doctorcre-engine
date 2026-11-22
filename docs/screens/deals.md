# Deals

- **For** each partner, signed in, on a computer or a phone. Both partners see every deal, including its documents and its client view, whoever owns it.
- **Must** show every open deal once, in its phase, with its deal owner and an attention badge when needed. Every card opens to its deal page. Every change a partner makes there saves to the new database, and a deal with a client website opens it from its deal page.
- **Must never** show the same deal twice, a card that cannot be opened, an internal code, a raw timestamp or a system word. It never asks a partner for a password to open a client's website. It never saves a partner's edit or decides a suggestion without that partner's click. What changes by itself, such as a phase move from a call or an invoice that closes a deal, shows as automatic, never as a partner's click.

The owner's test, in his words: "deal board+deal pages are fully built out, including being able to see the websites i build for each client". The roadmap's "done": the board and every deal page run on the new system, every change saves there, and each deal page shows that client's website. Each checkbox line is checked on the real screen, signed in, against a copy of production. Lines marked **Open** wait on an owner question below and are not checked until he answers. Examples use made-up names. Words follow `docs/glossary.md`.

## Everywhere on Deals

- [ ] Dates read as words in Central time: "Due Thu, Nov 19", "2 days late", "Moved automatically Mon, Oct 19". Never `2026-11-19` or `10/19`.
- [ ] No internal codes or system words: no client, lead or vendor codes, "The Deal Room", "workspace", "loaded", "retained text", "portal", "CARR", "landlord_side", "Request unavailable or version changed".
- [ ] A section that has nothing says so in plain words. "Unavailable" shows only when a read really failed, with Retry.
- [ ] If someone else saved the same field since the partner opened the deal, the save says so and offers to reload the deal. Nothing is overwritten.
- [ ] Every deal requires an owner. The deal's Owner list offers only the partners.

## Deal board

- [ ] Two tabs: Local Deals and National Accounts.
- [ ] All, Joe and Dell choose whose deals show. Board, List, Closed deals and Lost deals choose the view. Parked shows or hides the Parked lane on Board and List.
- [ ] Board: seven columns in order, Prospective Client, Research, Site Selection, Negotiating, Legal, Due Diligence, Closing. The phase name and count fit on one line, even when collapsed and on a phone. Spacing and a subtle divider separate the columns without outlining them. A closed deal leaves the board for Closed deals or Lost deals.
- [ ] The headline counts every open deal, including those in collapsed columns, and every parked deal, whether the Parked lane is open or not: "38 open deals · 27 parked".
- [ ] Each open deal shows once, in its phase column. A parked deal shows only in the Parked lane.
- [ ] With `deals-from-engine` on, the board stays current without the old live feed: it reloads from the engine when the tab is shown or focused, after each save, and about every minute while in use, and says when it last updated. National Accounts' pending confirmations load on their own (coordinator, 2026-11-20).
- [ ] List: one row per open deal with its name, deal owner, phase and next step. The List shows the deal owner's step when both partners have one. It shows an automatic move without Undo.
- [ ] Add deal asks for the deal name, the client (picked by name), the deal kind, the deal reason, the phase and the deal owner. Kind and reason may each be left unknown. When the reason is renewal, it also asks which existing lease the deal renews, and saves only with one. The lease picker shows "already renewed by <deal>" when a deal already links to that lease (owner, 2026-11-19).
- [ ] In each name picker, a match shows its city when known and how many deals it is on. A company that is already a national account offers "Open account" (owner, 2026-11-19).

### Card

- [ ] A card shows the deal's short name and owner. A click, tap or keyboard activation of the name opens the deal page.
- [ ] One small “Needs attention” badge appears when a partner flagged the deal or the deal owner's next step is late. Its accessible name gives the reason, such as “Needs attention: Step 3 days late.” A deal without a next step gets a badge only if flagged.
- [ ] Dragging a card to another column, or the same move by keyboard, asks for the phase move's details and moves it only on Move to [phase].

### Moving a phase

- [ ] The move asks what changed, the next step and its date, and an optional critical date with where it came from. The new step replaces the partner's own open next step on the deal, not counting checklist items.
- [ ] Choosing Closed anywhere opens the deal page's closing form. The form asks Won or Lost, and the date.
- [ ] Won asks the closed value, which may be left empty until known and is never zero. The deal leaves the board for Closed deals.
- [ ] Lost asks the reason and the date. The deal keeps everything and leaves the board for Lost deals.
- [ ] Setting a deal aside is Park, never a Paused outcome.

### Parked lane

- [ ] Each parked card shows the deal's name and owner, with one badge. Client paused and Prospect never active show their reason. Other shows as Parked.
- [ ] Open the deal page to see the parking details and Revive. Revive makes the deal active again in the phase it was in, and the card moves back to that column.

### Closed deals and Lost deals

- [ ] Each lists its deals with client, deal owner and the close date in words. Both sets of cards show "Deal kind" and "Deal reason", as in Add deal, with "Not recorded" for each unknown value. A deal with no recorded close date says "Close date not recorded". Lost deals also show the reason for loss. A copied loss with no recorded reason says "Not recorded before this system."
- [ ] Search finds deals by name, client, kind or close date.
- [ ] Each deal opens its deal page.

When the nightly invoice job closes a deal, Closed deals shows "Closed automatically: Invoice received" with its date in words and offers Undo. A copied automatic move to Closed shows "Closed automatically" with its date in words. When it has an invoice date and no invoice application to reverse, it keeps the date and caption, and Undo is hidden. Other copied closes offer phase Undo. A recorded loss appears in Lost deals without an automatic close badge or Undo.

## Prospects

A prospect is someone who may become a deal but is not one yet. The owner's words: the old spreadsheet worked because "it didn't block us from typing out a quick note or adding something in", and a lead once slipped for one to two months because it had no place to live.

- [ ] A lead shows as a prospect when it is at stage Opportunity and is on no deal. Adding a lead from the lane puts it at Opportunity (owner, 2026-11-18).

### Prospects lane

- [ ] Local Deals' Board shows a Prospects lane before Prospective Client, with its count. List shows the prospects after the deals, one row each.
- [ ] The headline counts them: "38 open deals · 27 parked · 9 prospects".
- [ ] All, Joe and Dell show the prospects that partner claimed. An unclaimed prospect shows under all three.
- [ ] Each card shows the name, who claimed it or "Unclaimed", the newest note's first line with who wrote it and when in words, and the soonest open follow-up with whose it is, such as "Joe · Due Thu, Nov 19", or "No follow-up set". A late follow-up says how late.
- [ ] Needs attention shows when a partner set it. It is the owner's "highlight".
- [ ] Order: Needs attention first, then by that follow-up date, soonest first, then those with none, newest first.
- [ ] Clicking the name opens the prospect.

### Adding a prospect

- [ ] Add prospect is one line at the top of the lane: a name, then an optional note. Enter saves.
- [ ] For someone new, the same line requires one tap to choose person or company and one to choose how found (owner, 2026-11-18).
- [ ] It is never refused because the person or practice is not a client or not in the system yet. A blank name, or a save that fails, keeps the line open with the typed name and note and says what is missing or what went wrong.
- [ ] While the partner types, people and companies already in the system with that name are offered. Picking one puts it in the lane, asking how found only when it has none. Picking a prospect already in the lane adds the note to it. Picking a client who is on no deal offers Add deal for them instead.
- [ ] Picking someone already on a deal keeps the add line open, says they are already on a deal and offers to open their deals.
- [ ] Adding a dropped person or company through Add prospect brings them back to the lane.
- [ ] A new prospect is unclaimed until a partner clicks Claim (owner, 2026-11-18: leads "go to no one until they are claimed").

### A prospect

- [ ] Shows the name, how found, who claimed it, Needs attention, each partner's open follow-up and the notes.
- [ ] The note box is at the top. Enter saves the note; there is no Save button.
- [ ] Notes run newest first, all of them, including those from before it was a prospect, each saying who wrote it and when in words: "Dell · Mon, Nov 16, 9:40 AM".
- [ ] With both partners on the same prospect, a note one saves shows on the other's screen within five seconds, with no reload. Checked with both partners signed in side by side.
- [ ] Follow-up takes a date and a few words, such as "Call back about the second location". It is the setting partner's next step on this lead: it replaces their open step on it, including an automatic check-in, which stays in history as replaced. Mark done on Home finishes it.
- [ ] Home shows a due follow-up as a step for its owner. Opening it from the inbox or Done puts that follow-up in view, with the recorded setter, date and source.
- [ ] Needs attention: a partner sets and clears it. Nothing sets it on its own.
- [ ] Claim makes the signed-in partner its owner. The owner can be changed to the other partner or back to Unclaimed.
- [ ] Turn into deal opens Add deal with the prospect's name, newest note and claimed owner filled in and editable (owner, 2026-11-19, question 11). The partner sets the client, phase and owner before saving. The client may be the prospect or another party, such as the practice a doctor runs. On save, the deal opens and the prospect leaves the lane. The prospect keeps its notes and follow-ups in its history.
- [ ] Drop asks for a reason and takes it off the lane. Its prospect page stays available, read-only, and shows "Dropped <date>: <reason>".
- [ ] If the other partner saved the same field since the prospect opened, the save says so and offers to reload. Nothing is overwritten.

## Monday review

The owner's words: every Monday they went over "all the deals we had, all the potential deals that werent yet technically a deal".

- [ ] Monday review opens from the Deals board on any day and covers the week that began that Monday, in Central time.
- [ ] It covers every open deal on Local Deals and National Accounts and every prospect, whoever owns or claimed it. The board's All, Joe and Dell choice and its collapsed columns do not narrow it.
- [ ] Order: deals by the phase each was in when the week began, in board column order, then by name; then prospects, oldest added first. Active deals and prospects that arrive during the week join just before parked deals. A phase move, a new follow-up or Needs attention never moves an item.
- [ ] Turn into deal carries the prospect's mark for that week to the new deal, with the same reviewer and time (owner, 2026-11-19).
- [ ] Add deal also carries the mark when the selected client is an active prospect.
- [ ] A new deal takes its prospect's place in the review for the week it was turned into a deal (owner, 2026-11-19).
- [ ] A deal closed or lost and a prospect dropped this week stay in place, saying so, so the count holds.
- [ ] Parked deals come last in the Monday review, after prospects (owner, 2026-11-18).
- [ ] The top says how far along it is: "31 of 47 reviewed this week". Not reviewed only hides the reviewed ones.
- [ ] One at a time shows one deal or prospect: its name, owner, phase or "Prospect", Needs attention, next step or follow-up, its latest notes and the note box. Next and Back move through the list.
- [ ] As a list shows the same items, one row each, with the note box and the next step or follow-up opening in place.
- [ ] Change next step on a deal and Follow-up on a prospect save as they do on the deal page and the prospect. A note saved here shows on the other partner's open review within five seconds, as on a prospect.
- [ ] Reviewed marks the item reviewed this week, saying who and when, and goes to the next. Undo removes the mark, also after a reload.
- [ ] Opening a name goes to the deal page or the prospect. Back returns to the same place in the review.
- [ ] Opening a Dropped row goes to the read-only prospect page. The row keeps Reviewed and Undo.
- [ ] Each deal or prospect has one review mark per week. Both partners see who marked it, and either can Undo it (owner, 2026-11-18).
- [ ] Monday review replaces the old pipeline call sittings. The deal page keeps its call recorder (owner, 2026-11-18).

## National Accounts

- [ ] One card per national account: its name, its account owner, and how many open deals, deals with a late next step and parked deals it has. No client codes.
- [ ] Add national account saves its company name and account owner. When a name matches an existing company, offer "Make this company a national account". Open an existing national account from its match. Ask for confirmation to add a separate company with the same name (owner, 2026-11-19).
- [ ] Change account owner offers Joe and Dell. It changes only the account owner (owner, 2026-11-18).
- [ ] Opening an account lists its deals, one row per location deal: name, market, phase, next step and market agent. The Last row shows the whole completed step when it is the latest activity, including on a phone.
- [ ] A location with no market says "No market recorded".
- [ ] Add market deal lists markets and the account's current locations by name. Pick a market and a location, or add a person or company as the location. An optional market agent is picked from existing people.
- [ ] A new location client under a national account has "national account or corporate lead" as how found (owner, 2026-11-18).
- [ ] National-account deals whose client is a person show under their account (owner answer, 2026-11-18).
- [ ] Each row opens the deal page. Park and the phase work as they do on the board.

## Deal page

The header shows the deal's name, client, phase, deal owner and next critical date, once each. Back to deals returns to the board where the partner left it.

### Overview

- [ ] Client website, near the top, when the deal has one. For a signed-in partner it opens the client's site already unlocked, in a new tab, and asks for no password.
- [ ] The new database keeps each deal's client website registration so the deal page can still show its Client website link after the switch (owner, 2026-11-18, #728).
- [ ] A deal with no website says "No client website linked."
- [ ] Set up client website stays below the deal's facts and asks for the website name and a password (owner, 2026-11-18).
- [ ] Next steps uses the [Home step title rule](home-inbox.md#every-card) and shows the full instruction beneath the heading when the wording differs. Still needed and its item detail follow the same rule. Each distinct open step wording appears once. When both partners have steps with the same wording, show both owners beneath it with their own due dates and Done buttons. Use each owner's first name and show due dates in words. Each open step says who set it and when. If the setter was not recorded, it shows when alone. A late step also shows "N days late". A Home card for one of the steps opens here with that step in view.
- [ ] Closing or losing a deal leaves its steps unchanged. On the deal page, steps still open appear under "Open before this deal ended" with their due dates. Ended deals never count a step as late anywhere on Deals.
- [ ] Either partner can choose Done on any open next step on a deal they can open, including a step owned by the other partner or still open on an ended deal. Each owner’s details sit next to their own keyboard-accessible Done button with a touch target at least 44 pixels tall and wide. Rows use the app's colors in both themes without individual card outlines.
- [ ] Done uses the same engine save as Home's Mark done (door 18, end by step ID). It sends the version shown on the deal page. After saving, the step leaves the open list and Timeline shows its completion and who marked it done.
- [ ] If the step changed or was already finished, the save is refused. The page says "This step changed. Review the latest version." and reloads the deal so the partner can see the current steps and Timeline.
- [ ] "Still needed" shows the step's owner and date.
- [ ] Change next step saves the partner's new step and date, replacing their own open step. A step saved without an owner belongs to the partner who saved it.
- [ ] Facts: deal kind, deal reason, market, closed value when closed, and the market agent on a national-account deal. A deal with no market says "No market recorded". Closed and lost cards and the deal page keep the Renewal label for copied renewals with an unrecorded source lease and show a note that the lease wasn't recorded.
- [ ] A lost deal's page shows the reason for loss and the close date in words. A copied loss with no recorded reason says "Not recorded before this system." If there is no close date, it says "Close date not recorded".
- [ ] Phase, deal owner and Park, with the same rules as the board. Park asks the reason (client paused, prospect never active, or other) and takes an optional note.
- [ ] A parked deal shows the reason, note when present, and date. If the old automation parked it, the page says “Parked automatically.”
- [ ] The current automatic call move or copied automatic move shows “Moved automatically” with its date in words and offers Undo. If Undo would return the deal to Closed deals or Lost deals, it explains why the deal stays in its current phase.
- [ ] Needs attention: a partner sets and clears it. Nothing sets it on its own.
- [ ] Checklist: the deal's checklist items, each with its due date in words. Clicking one opens it.
- [ ] Checklist progress uses plain labels like "Lease expiration for renewal", "Invoice" and "Commission received". It shows which confirmed dates are due. Commission received is complete when all saved payments have receipt dates, even if the deal still has an expected amount.
- [ ] Critical dates: each with its name in plain words, its date in words and its state. A proposed date, such as one read from a lease, shows Confirm and Drop. Confirm makes it a confirmed date. Drop asks a reason. A confirmed date can be marked done, dropped or passed, each with a reason. Only a partner's click decides.
- [ ] Phase effective date is a kind the partner can choose when adding a critical date.
- [ ] Terms: Show sourced terms lists each lease term found in the deal's documents, with its document, pages and quoted text. Approve, Correct and Reject each take a reason and save the partner's choice, as on Home's lease fact card.
- [ ] Email follow-ups show each distinct decision targeting the deal once, with its email. A filing suggested on every message of a conversation shows once, with its newest message. Accept and Dismiss work as on Home's email suggestion. An email already filed to the deal has no "File email to this deal" action. Use the partner's Home card title when the card shows the same email. Otherwise use the saved action for the email or title the pending decision. Keep the email subject in Correspondence & notes.
- [ ] Update: a note saved to the deal's history with its author and time.
- [ ] In Updates, Show deal attribution opens a panel with a link to the credited deal. When the activity is filed to several deals, the panel links to each candidate and shows zero credited activities. [Activity deal attribution](../new-database.md#activity-deal-attribution).
- [ ] Vendors on the deal, each opening its vendor page.
- [ ] Watch settings and the deal page's call recorder work as they do today. After the switch, watch settings use the old tables and cover copied deals only (#805).
- [ ] The deal page's call review shows recent recorded calls for that deal and the evidence and state of each visible suggestion. The partner confirms or dismisses pending suggestions through the same decision as Home. [Deal call outcomes](../new-database.md#deal-call-outcomes).
- [ ] When a call note is private or the assignee already has an open ordinary next step, the card explains why Accept is unavailable and still offers Dismiss. Open checklist items leave Accept available.

### Tabs

- [ ] Compare terms: recorded terms from deals in the same submarket and use type, each value with where it came from.
- [ ] Timeline lists phase moves, notes, next steps, critical dates, documents, and changes, newest first. Each says which partner or job saved it and when. A note with a matching event appears once.
- [ ] Timeline uses the parking reason labels and note wording from Overview. An entry with no note shows only the reason. Timeline uses "Deal kind" and "Deal reason" as in Add deal, including in imported deal openings. It says "Not recorded" for unknown values in those fields.
- [ ] The deal page shows older events with no other home in read-only imported history. Each entry shows when it was recorded, the user or job, and what happened. Missing facts stay blank. An attachment action already shown as a document event appears once. Copied notes show their words and dates in readable form. Empty notes and technical lines stay in the old system. Owner changes marked as automatic are credited to the move.
- [ ] Correspondence & notes shows every email and meeting filed to the deal, newest first, and the deal's notes. An email shows its sender, date and subject and appears here even if it has a pending follow-up. A meeting shows its title and time.
- [ ] Documents show every file on the deal and open it on click for either partner. When old uploads contain identical bytes, the earliest filing appears once. Different files with the same name and kind show their version numbers in filed order.
- [ ] Either partner can open a document's extracted text in Documents. Pages appear in order, with blank pages in their original positions. If the file has no usable extracted text, the view says so. See the [deal document text read](../new-database.md#deal-files-and-extracted-text).
- [ ] Client view gives both partners the same Client website button as Overview. It opens the client's website unlocked in a new tab. The tab says "No client website linked." when the deal has no website. The owner dropped file sharing from Client view (`docs/new-database.md` § "Deal files and extracted text").

### Tours

- [ ] Both partners can open Tours from the deal page. Tour planning starts here. The sidebar has no Tours entry.
- [ ] Each planned tour appears once with its date in words. Open it to see its notes and its stops in visiting order. Each stop shows its address and its property name when known. An empty list says "No planned tours."
- [ ] **Plan tour** asks for a date, at least one property, and optional notes. The deal's linked properties appear first, each addable with one tap. Search below by name or address. Both pickers mark selected properties as added and disable their buttons until the partner removes the stop. If nothing matches, say so and open **Add property** with its address and optional name in the scrolling form. **Search properties**, **Save tour**, and **Back to tours** stay in view on desktop and phone.
- [ ] Before saving, either partner can add, remove, and reorder stops. The order controls work by keyboard and touch.
- [ ] Either partner can edit a planned tour. After saving and reopening it, both partners see the saved date, order, and notes. A failed save leaves the edits in view and says what to fix. A save based on an older version offers to reload the tour before editing again.
- [ ] The client stop list preview shows the date and the numbered stops in saved order. Each stop includes its address and its name when known. **Copy stop list** copies the preview for the partner to paste into Outlook. Tour notes stay on the deal page.
- [ ] **Mark done** starts with the planned date and stops. The partner confirms the actual local date and time and the properties visited. They can omit a skipped stop and add a property visited off-plan. The saved plan keeps its original order.
- [ ] After **Mark done** saves, the plan leaves the planned list and one meeting appears in **Correspondence & notes**. Opening the meeting shows the visited properties. Trying **Mark done** again leaves one meeting.
- [ ] **Cancel tour** asks for confirmation. Once confirmed, the plan leaves the planned list, the cancellation appears in the deal's change history, and no meeting is added.
- [ ] A client's comment on a toured property or a shortlist change still appears on Home. Opening it shows the property and the saved feedback. **Done** finishes the review there.

See [Planned tours on a deal](../new-database.md#planned-tours-on-a-deal).

## Questions for the owner

1. Answered on 2026-11-18 (#728). The new database keeps each deal's client website registration.
2. Answered on 2026-11-18 (#718): Checklist progress comes from the deal's saved facts after the switch. Pass D found zero document requests to move.
3. Answered on 2026-11-18. Copied automatic phase moves keep the “Moved automatically” mark and Undo on the deal page (updated 2026-11-20). List shows the mark.
4. Answered on 2026-11-18. A person who is a client may belong to a national account.
5. Answered on 2026-11-19. When both partners have an open next step on one deal, the deal page shows both. The Board uses the deal owner's step to decide whether to show a late badge (updated 2026-11-20).
6. Answered on 2026-11-18. Set up client website stays below the deal's facts and asks for a website name and a password.
7. Answered on 2026-11-19. Compare terms keeps the comparison of recorded terms from deals in the same submarket and use type.
8. Answered on 2026-11-19. The owner ruled that "deal watch settings and the deal page call recorder stay as they work today".
9. Answered on 2026-11-18. For someone new, Add prospect requires one tap for person or company and one for how found on the add line.
10. Answered on 2026-11-18. A prospect is a lead at stage Opportunity that is on no deal. Adding a lead from the lane puts it at Opportunity.
11. Answered on 2026-11-19. Turn into deal opens Add deal with the prospect's name, newest note and claimed owner filled in. The partner sets the client, phase and owner before saving.
12. Answered on 2026-11-18. Both partners share one mark per deal or prospect per week. It shows who marked it, and either can Undo it.
13. Answered on 2026-11-18. Parked deals come last in the Monday review, after prospects.
14. Answered on 2026-11-18. Monday review replaces the old pipeline call sittings. The deal page keeps its call recorder.

## Not yet true

Checked against app main on 2026-11-19. The new Deals paths depend on the switches in [The system](../system.md#switches).

- Deal watch settings still save to the old database and cover only copied deals (#805).
- With the old read, the Documents tab's Deliverables section can say "Request unavailable or version changed" when it cannot list files (old system #3232). The tab also says "retained text" and "loaded documents".
- With the old read, email follow-ups can offer File to existing deal and New deal. They can also show "Sender unavailable", "Summary unavailable" or a role code such as `landlord_side`. The new read offers Accept and Dismiss when the new saves are on.
- With the old read, a critical date filed as Other can show a lowercase note as its label. The countdown still uses a bare day count for future dates, such as "864 days".
- With the new saves off, national account cards can show a client code and say "Sub-clients". A missing review time shows as "Last account review: not captured" on those cards.
- With the old read, Lost deals say "Not recorded" when the close date is missing. The new read says "Close date not recorded" and shows the reason when the deal has one.
- With the new saves off, regular Add deal still asks for "Type", labels the phase "Stage" and takes the client as "C-ref or exact client name".
- Closing on the old path still offers Paused. Phase moves still ask for "Evidence" and "In your words". The new save path calls the step "Your next step". The old path calls it "Next item (2–4 words)".
