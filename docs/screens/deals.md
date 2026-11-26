# Deals

- **For** each partner, signed in, on a computer or a phone. Both partners see every deal, including its documents and its client portal, whoever owns it.
- **Must** show every open deal once, in its phase, with its deal owner and an attention badge when needed. Every card opens to its deal page. Every change a partner makes there saves to the new database, and a deal with a client website opens it from its deal page.
- **Must never** show the same deal twice, a card that cannot be opened, an internal code, a raw timestamp or a system word. It never asks a partner for a password to open a client's website. It never saves a partner's edit or decides a suggestion without that partner's click. What changes by itself, such as a phase move from a call or an invoice that closes a deal, shows as automatic, never as a partner's click.

The owner's test, in his words: "deal board+deal pages are fully built out, including being able to see the websites i build for each client". The roadmap's "done": the board and every deal page run on the new system, every change saves there, and each deal page shows that client's website. Each checkbox line is checked on the real screen, signed in, against a copy of production. Lines marked **Open** wait on an owner question below and are not checked until he answers. Examples use made-up names. Words follow `docs/glossary.md`.

## Everywhere on Deals

- [ ] Dates and times read as words in Central time with no zone label: "Due Thu, Nov 19", "2 days late", "Moved automatically Mon, Oct 19". Never `2026-11-19` or `10/19`. Only a time shown in another zone names its zone (owner ruling, 2026-11-24).
- [ ] An old record code in a note or step, such as `C-013`, reads as that record's name and opens it; one that matches no record reads "an old record".
- [ ] No internal codes or system words: no client, lead or vendor codes, "The Deal Room", "workspace", "loaded", "retained text", "CARR", "landlord_side", "Request unavailable or version changed".
- [ ] A section that has nothing says so in plain words. "Unavailable" shows only when a read really failed, with Retry.
- [ ] If someone else saved the same field since the partner opened the deal, the save says so and offers to reload the deal. Nothing is overwritten.
- [ ] Every deal requires an owner. The deal's Owner list offers only the partners.
- [ ] Writing a partner did not do names its writer plainly wherever an author shows, on deal notes, deal Activity, client activity and Updates: "Written by the assistant", "Copied from the old system", "Mail filing". Never "Agent for" a partner, and never "Doc (assistant)" for a copy (#1281).

## Deal board

- [ ] The top bar names the page once: Local Deals, with National Accounts beside it as a quieter link. On a phone narrower than 480 the link reads "National".
- [ ] All, Joe, Dell and the view choices share the top bar when they fit. When they do not, as at 1280 with Today open, they move to their own row under it. No control is ever cut off.
- [ ] All, Joe and Dell choose whose deals show. Board, List, Timeline, Closed deals and Lost deals choose the view. Parked shows or hides the Parked lane on Board and List.
- [ ] Board: seven columns in order, Prospective Client, Research, Site Selection, Negotiating, Legal, Due Diligence, Closing. The phase name and count fit on one line, even when collapsed and on a phone. Each column is a faint, borderless panel as tall as its cards; an open column ends with **+ Add deal**, which opens Add deal set to that phase. Today starts collapsed on Board and List and keeps each partner's own choice, separate from National Accounts and Monday review. With Today closed, all columns fit at 1280 and 1440 wide with every phase name whole and no sideways scrolling. With Today open, the board scrolls sideways inside itself. On a computer the board fills the screen below the heading, the page does not scroll, and a full column scrolls inside itself with its phase name in view. The board and its columns show no scroll bar; a thin, faint thumb shows on a column only while it scrolls (owner, 2026-11-25). On a phone the board scrolls with the page. A closed deal leaves the board for Closed deals or Lost deals (owner, 2026-11-23).
- [ ] The headline counts every open deal, including those in collapsed columns, and every parked deal, whether the Parked lane is open or not: "38 open deals · 27 parked".
- [ ] Each open deal shows once, in its phase column. A parked deal shows only in the Parked lane.
- [ ] With `deals-from-engine` on, the board stays current without the old live feed: it reloads from the engine when the tab is shown or focused, after each save, and about every minute while in use, and says when it last updated. National Accounts' pending confirmations load on their own (coordinator, 2026-11-20).
- [ ] List: one row per open deal with its name, deal owner, phase and next step. The List shows the deal owner's step when both partners have one. It shows an automatic move without Undo.
- [ ] On a computer, the List and the Prospects lane scroll together inside the board's box, with Prospects after the last deal. No deal row sits under the Prospects lane, the lane shows whole with its **+ Add prospect** control, and the page does not scroll. Check at 1280 and 1440 wide, with Today open and closed.
- [ ] No card or List row has a star, and stars do not change the order (owner, 2026-11-25: "every deal is important").
- [ ] Add deal asks for the deal name, the client (picked by name), the deal kind, the deal reason, the phase and the deal owner. Kind and reason may each be left unknown. When the reason is renewal, it also asks which existing lease the deal renews, and saves only with one. The lease picker shows "already renewed by <deal>" when a deal already links to that lease (owner, 2026-11-19).
- [ ] In each name picker, a match shows its city when known and how many deals it is on. A company that is already a national account offers "Open account" (owner, 2026-11-19).

### Timeline

The owner approved the timeline design on 2026-11-25, with every change it proposed. Timeline draws every open deal in time, using the same plan as each deal's [Plan](#plan) tab.

- [ ] Timeline is a third view after Board and List. Its controls sit in the top bar, so the first deal starts 100px from the top. 14 deal rows fit at 1280x640 and 22 at 1440x900.
- [ ] One folded row per open deal shows its name, the "Needs attention" dot when there is one, its phase and its deal owner. The row's bar is the deal's phases end to end, each in its phase color: bright for time spent, dim for expected. A hollow diamond marks the expected lease signing with its date and "exp.".
- [ ] Opening a deal's row shows its current phase's to-dos, steps and critical dates with the same bars and arrows as its Plan. The deal's name opens the deal page.
- [ ] Deals sort furthest along first, Closing at the top. The other sorts are by deal owner and by expected signing. All, Joe and Dell choose whose deals show.
- [ ] Week and Month zoom. The left list has Milestones (the next critical dates and expected signings, each with its deal's name) and the saved views My deals, At risk and Next two weeks.
- [ ] A stale deal shows one solid bar and how long it has sat, such as "148 days in Prospective Client", with nothing expected.
- [ ] Dragging a step's end there moves its due date, as on Plan.
- [ ] On a phone the chart stays, with a narrow name column and no dragging.

A Leases ending lane at the bottom waits until the first lease ending is recorded.

### Card

- [ ] A card shows the deal's short name, then one row with the “Needs attention” badge when there is one and the deal owner's initial. The next step, its due date and late counts stay on the deal page (owner, 2026-11-20). A click, tap or keyboard activation of the name opens the deal page.
- [ ] One small “Needs attention” badge appears when the system says the deal needs attention. Its reason shows on hover and is its accessible name, the same sentence as the deal page's Needs attention line. No partner sets or clears it on a deal (owner, 2026-11-25).
- [ ] When an open deal has no open step of its own and is its client's only open deal, its List row shows the client's open step, marked "Client step: <what>". The board reads it from the client and moves nothing. When neither the deal nor its client has a step, the List row shows "No next step set". A step with no date still shows, and it counts as a next step. Home's "N have no next step" counts the open deals whose row says "No next step set".
- [ ] Dragging a card to another column, or the same move by keyboard, asks the same short question as a phase click on the deal page and moves it only on Move to [phase].

### Moving a phase

- [ ] The move asks one question, such as "Move this deal to Legal?", with an optional "What changed" line. It asks for no next step and no critical date (owner, 2026-11-25).
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

- [ ] Local Deals' Board shows a Prospects lane before Prospective Client, with its count. Its header sits on the phase headers' line, with the count right after the name. On a phone it comes after the deal phases. List shows the prospects after the deals, one row each.
- [ ] The headline counts them: "38 open deals · 27 parked · 9 prospects".
- [ ] All, Joe and Dell show the prospects that partner claimed. An unclaimed prospect shows under all three.
- [ ] Each card shows the name, who claimed it or "Unclaimed", the newest note's first line with who wrote it and when in words, and the soonest open follow-up whoever owns it, as its wording over whose it is and when, such as "Call about the lease" over "Joe · Due Thu, Nov 19", or "No follow-up set". A follow-up with no shorter title shows its stored wording, never a blank line. An automatic check-in reads as on [Home](home-inbox.md#every-item), such as "Check in with Example Clinic (client)". A late follow-up says how late.
- [ ] Needs attention shows when a partner set it. It is the owner's "highlight".
- [ ] Order: Needs attention first, then by that follow-up date, soonest first, then those with none, newest first.
- [ ] Clicking the name opens the prospect.

### Adding a prospect

- [ ] **+ Add prospect** at the top of the lane opens the quick add in its place, with the name focused: a name, then an optional note. Enter saves. **Cancel** or Esc closes it and puts focus back on **+ Add prospect**.
- [ ] For someone new, the quick add requires one tap to choose person or company and one to choose how found (owner, 2026-11-18).
- [ ] It is never refused because the person or practice is not a client or not in the system yet. A blank name, or a save that fails, keeps the quick add open with the typed name and note and says what is missing or what went wrong.
- [ ] While the partner types, people and companies already in the system with that name are offered. Picking one puts it in the lane, asking how found only when it has none. Picking a prospect already in the lane adds the note to it. Picking a client who is on no deal offers Add deal for them instead.
- [ ] Picking someone already on a deal keeps the quick add open, says they are already on a deal and offers to open their deals.
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
- [ ] One at a time shows one deal or prospect: its name, owner, phase or "Prospect", Needs attention, next step or follow-up, its latest notes and the note box. Next and Back move through the list. An automatic check-in reads as on [Home](home-inbox.md#every-item), such as "Check in with Example Clinic (client)".
- [ ] As a list shows the same items, one row each, with the note box and the next step or follow-up opening in place.
- [ ] Change next step on a deal saves as **Add step** does on the deal page, and Follow-up on a prospect as it does on the prospect. A note saved here shows on the other partner's open review within five seconds, as on a prospect.
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
- [ ] The top bar reads Local Deals, then National Accounts as the page title. An open account's name follows it once, as does "Search results" during a search. Open deals, Closed deals and the last update time sit in the top bar beside them when they fit. On a phone the update time ends the toolbar instead.
- [ ] One toolbar row holds All national accounts, the account owner ("Owned by Dell", which opens Change account owner), **Show**, search, Review deals or Monday review, and Add national account or Add market deal. It stays one row at 1280 and 1440 with Today open. The account cards view shows only search, Add national account and the update time. Today starts collapsed and keeps each partner's own choice for National Accounts, separate from Local Deals.
- [ ] **Show** has a visible label and one choice of Active, Mine, Needs attention, Gone quiet, Missing next step, Changed since review or Parked. It is outlined when anything but Active is chosen.
- [ ] Each row opens the deal page. Park and the phase work as they do on the board. On a computer the phase reads as text, and the phase arrow and Park show when the pointer is on the row or keyboard focus reaches it. Touch screens always show them.
- [ ] A deal that needs attention says "Needs attention" on its row without hover. A late next step also says "N days late".

## Deal page

The owner approved this design on 2026-11-25, with every change it proposed. On a computer the page does not scroll at 1280x640 or 1440x900; a long region scrolls inside itself. Every scrolling region shows no scroll bar at rest and a thin, faint thumb only while it scrolls, as the board's columns do.

### Header

- [ ] The top bar reads "Deals / " and the deal's name. **Deals** returns to the board where the partner left it.
- [ ] One row of tabs: Overview, Plan, Activity, Tours, Documents and Client portal.
- [ ] On the right of the tab row, in the muted tone: the client, the phase, the deal owner, then deal kind, deal reason and market, and the market agent on a national-account deal. The next critical date is not in the header; it is the first row of Overview. The client's name opens the client. The deal owner opens the choice of Joe or Dell. A deal with no market says "No market recorded".

### Overview

Overview answers four questions on one screen: which dates matter, where the deal stands, what happens next, and what Doc can take off the partner's hands.

- [ ] Critical dates are the first row under the tabs, soonest first, in one row that never wraps. Each tile shows the date's name in plain words, the date in words and how far off it is. Within 7 days the count turns amber, and past due it turns red. More dates than fit scroll the row sideways. The last tile is **+**, which adds a date; Phase effective date is one of its kinds. A deal with no dates shows one line with **Add date**.
- [ ] A proposed date, such as one read from a lease, says "proposed" and has **Confirm** on its tile. Opening a tile offers Confirm or Drop for a proposed date, and Mark done, Drop or Passed for a confirmed one, each with a reason. Only a partner's click decides.
- [ ] The path shows every phase as a tile, Prospective Client to Closed, left to right with an arrow between each. The current phase's tile is brighter and wider, has an orange top edge and counts its finished to-dos, such as "1 of 3". A finished phase has a check beside its name.
- [ ] Each tile lists that phase's to-dos from the checklist, in plain labels such as "Lease expiration for renewal", "Invoice" and "Commission received". To-dos tick themselves from what is filed and recorded; a partner never ticks one. A finished to-do has a green mark, one with a date shows it in words, and a late one is red and says why. Commission received is finished when every saved payment has a receipt date. Prospective Client and Due Diligence say "Nothing listed" until the partners' workflow table fills them. See [Checklist under the phases](../new-database.md#checklist-under-the-phases).
- [ ] Clicking a to-do opens it: its document, its date, or what is still missing.
- [ ] Clicking a phase name asks "Move this deal to Legal?" with an optional "What changed" line, **Move to Legal** and **Cancel**. Nothing moves without the second click. It asks for no next step and no critical date.
- [ ] Clicking Closed asks Won or Lost and the date. Won asks the closed value, which may stay empty until known and is never zero. Lost asks the reason.
- [ ] A move the system made says "Moved automatically Mon, Nov 23 · Undo" under the phase name. Undo works for 7 days from when the move was recorded, then the mark stays without it (owner ruling, 2026-11-24). If Undo would return the deal to Closed deals or Lost deals, it explains why the deal stays in its current phase.

#### Next steps

- [ ] Needs attention is one amber line at the top of Next steps with the system's reason, such as "The landlord's broker has not answered the Nov 17 counter. 8 days quiet." It shows only when the deal needs attention. No partner sets or clears it. See [Deal attention](../new-database.md#deal-attention).
- [ ] Open lists each open step with whose it is, when it is due, how late, and who set it and when, and a circle that marks it done. Titles follow the [Home step title rule](home-inbox.md#every-item). Each distinct open wording appears once; when both partners have it, both owners show beneath it with their own due dates and circles. A Home row for one of the steps opens here with that step in view.
- [ ] Either partner can mark any open step done, including the other partner's. The circle uses Home's Mark done save (door 18, end by step ID) with the version shown, and is keyboard reachable with a 44px touch target. If the step changed or was already finished, the page says "This step changed. Review the latest version." and reloads the deal.
- [ ] Suggested lists steps the assistant proposes. Each says where it came from: an email ("From the client's email, Tue, Nov 24") or the deal workflow ("From the checklist · Terms comparison is next in Negotiating"). **Accept** makes it that partner's step with its date filled in. **Edit** changes the wording, date or owner first. **Dismiss** drops it. A suggestion is no partner's step, and stays off Home's Reminders, until a partner accepts it.
- [ ] Under an email suggestion the email shows cleaned up: who sent it and when in words, then its paragraphs, with no headers, signatures or quoted history. Each pending decision shows once; a filing suggested on every message of a conversation shows once, with its newest message. An email already filed to the deal has no "File email to this deal" action.
- [ ] Other things waiting on a partner's answer sit in the same list with **Review**. Lease terms read from a document offer Approve, Correct and Reject, each with a reason, as on Home's lease fact card. A call to log saves its text on the call when accepted; when the assignee already has a conflicting open ordinary step, it explains why Accept is unavailable and still offers Dismiss. [Deal call outcomes](../new-database.md#deal-call-outcomes).
- [ ] **Add step**, a quiet control in the corner, saves the partner's own step and date, replacing their own open step. A step saved without an owner belongs to the partner who saved it.
- [ ] Closing or losing a deal leaves its steps unchanged. Steps still open show under "Open before this deal ended". Ended deals never count a step as late anywhere on Deals.

#### The rest of Overview

- [ ] Latest activity has a note box, then the last eight things that happened, one line each. Enter saves the note to the deal with its author and time. **All activity** opens Activity.
- [ ] Ask Doc to lists **Build client website**, **Draft requirement email** and **Compare LOIs**. Each shows where it stands, such as "Built Nov 9", "Sent Nov 6" or "2 on file", and starts or reopens its Doc session. Build client website reads **Update client website** once the deal has a site. See [Start Doc from a button](doc.md#start-doc-from-a-button).
- [ ] Invoice shows three marks in a row, Triggered, Sent and Paid, each with its date in words once it happens. Before any, one line says when it goes out, such as "Goes out when the lease is signed". Once paid it reads "Invoice paid on Nov 28". It shows no amounts and no invoice email details. See [Invoice dates](../new-database.md#invoice-dates).
- [ ] People lists the client's contact, the landlord's broker, the attorney and any other vendor on the deal, each by name and role. Each opens that person or vendor.
- [ ] Park deal is a quiet line at the bottom right. It asks the reason (client paused, prospect never active, or other) and takes an optional note. A parked deal shows one line at the top of Overview with the reason, the note when present, the date and **Revive**, which returns the deal to its phase. If the old automation parked it, the line says "Parked automatically."
- [ ] A lost deal shows the reason for loss and the close date in words. A copied loss with no recorded reason says "Not recorded before this system." With no close date it says "Close date not recorded". A copied renewal with an unrecorded source lease keeps its Renewal label and says the lease wasn't recorded.
- [ ] The deal page's call recorder works as it does today (owner, 2026-11-18).

The redesign removed Mark needs attention, deal watch settings (every deal is watched), Client and vendor context, the phase dropdown, Set up client website, the Email follow-ups heading and the Compare terms tab.

### Plan

Plan answers "when, and are we on pace". It draws the deal's checklist and steps in time, one row each under its phase, with what is recorded solid and what is expected dashed. The engine lays it out; see [Deal plan](../new-database.md#deal-plan). On a computer it fills the page below the tabs and the chart scrolls both ways inside itself.

- [ ] Plan is the second tab, after Overview. Overview's path does not change.
- [ ] The left list has one row per to-do, step and critical date under its phase, each with a mark, its name and a date: a green check for finished, a filled ring for the to-do the deal is on, a dashed ring for expected, the owner's initial for a step, a diamond for a critical date, and a red **!** for a late step or anything at risk.
- [ ] Each phase row folds, shows its count such as "1 of 3" and a thin bar over the phase's days. Finished phases start folded. The fold is remembered on the device.
- [ ] Time runs along the top with Day, Week and Month. Weekends are shaded. An orange pill and line mark today, and **Today** brings it back into view.
- [ ] Recorded bars are solid in their phase's color and sit on recorded days. The to-do the deal is on is solid up to today and says how far along it is, such as "day 9 of 21". There is no percent done.
- [ ] Expected bars are dashed, and every expected date says "exp.". **Recorded only** hides everything expected.
- [ ] Steps are thinner pills with their owner's initial, from the day set to the day due. A late step is outlined red.
- [ ] Critical dates are diamonds on their days; a proposed one is hollow. A to-do expected to finish after a critical date it must beat turns its arrow red, and the date says "at risk".
- [ ] Arrows follow the workflow's order with right-angle routes, and break around a label.
- [ ] A deal sitting more than twice the typical length on its to-do shows no expected dates. Its row says how long it has sat.
- [ ] Milestones lists the deal's critical dates soonest first, plus the expected lease signing; a click scrolls to it. Saved views are My steps, At risk and Next two weeks, each with its count, then Recorded only. Both, Dell and Joe choose whose steps show.
- [ ] Pointing at a bar brightens it and its arrows, fades the rest, and a note gives its dates and where they come from.
- [ ] Clicking a bar opens it on the right. A step offers Mark done and Change date. A critical date offers Confirm or Mark done, and Drop. A to-do shows its facts and offers Set your own date.
- [ ] Dragging a step's end moves its due date through the same save Home and Calendar use. Dragging an expected bar's end sets the partner's own date for that to-do on this deal, and what follows moves with it while dragging. A dashed outline keeps the old place and a label gives the new date.
- [ ] Letting go saves. The footer says what changed, such as "Terms comparison: expected by Mon, Dec 14. What follows moved with it.", with **Undo**. **Reset to typical** clears the deal's own dates after one confirmation.
- [ ] A critical date, a bar's start, a finished bar and a phase bar never drag. A drag cannot set a past day. Dragging works at Day and Week zoom only. With the keyboard, a focused bar's end moves a day with the arrow keys and a week with Shift; Enter saves and Esc cancels.
- [ ] Either partner can drag either partner's step. If the step changed since the page loaded, it says "This step changed. Review the latest version." and reloads.
- [ ] **Typical lengths**, bottom left, opens the table of typical days per to-do. A partner edits any number there and it saves; no confirmation step. Once a to-do has five finished examples, the measured number shows beside it with **Use measured**, and nothing changes without that click.
- [ ] The current phase's tile on Overview gains one quiet line, such as "Lease signing expected Mar 5", which opens Plan.
- [ ] Expected dates never show on Home or Calendar.

### Activity

- [ ] Activity is the deal's one history. On the left: the note box, the filters All, Emails, Notes, Calls and meetings, Documents and Changes, then every email, note, call, meeting, tour, document, phase move and change, newest first, under "This week", "Earlier in November" and earlier months. Each row says what happened in plain words, then who and when. Each thing shows once; a note with a matching event appears once.
- [ ] Clicking a row opens it on the right. An email opens as its whole conversation, one message under another, each headed by its sender and time in words, with **Show the full emails** for the raw text. A suggestion on that email sits at the top with **Accept** and **Dismiss**. **Reply** and **Ask Doc** sit in the corner.
- [ ] An email's sender is the name saved with the email, else the one contact who has that address, else the address. A meeting shows its title and time. An activity's open view shows its deal attribution: a link to the credited deal, or, when it is filed to several deals, a link to each candidate and zero credited activities. [Activity deal attribution](../new-database.md#activity-deal-attribution).
- [ ] Changes use Overview's parking reason labels and note wording, and "Deal kind" and "Deal reason" as in Add deal, with "Not recorded" for an unknown value. A parking change with no note shows only the reason.
- [ ] Copied history from the old system sits in the same list under its own dates. Each entry shows when it was recorded, the user or job, and what happened. Missing facts stay blank. A machine sign-in (`joe-local`, `dell-local`) reads as that partner. An entry by a machine sign-in or an old automation reads "Automatically". An owner with no name is left out, and the change itself still shows. An attachment already shown as a document appears once. Copied notes show their words and dates in readable form; empty notes and technical lines stay in the old system. Owner changes marked automatic are credited to the move.

### Tours

- [ ] Both partners can open Tours from the deal page. Tour planning starts here. The sidebar has no Tours entry.
- [ ] On the left, "On the client's website" shows the properties on the deal's client website as cards with photo, name, size and rate. Tapping a card's **+** or dragging it to the right adds it. An added card shows its stop number.
- [ ] On the right, Tour has the date, the start time, the stops in visiting order and notes for the packet. Stops reorder by drag, keyboard or touch, and x removes one. Each stop shows its address and its property name when known.
- [ ] **Generate tour packet** saves the tour and opens a PDF to print or email: a cover with the date and stop times, then a page per property. **Save tour** keeps it as a planned tour. **Copy stop list** copies the date and the numbered stops for the partner to paste into Outlook.
- [ ] A deal with no website adds stops by search, by name or address, as before. If nothing matches, it says so and opens **Add property**. A line offers **Build client website**.
- [ ] "Planned 1 · Past 1" opens the planned and past tours. Each planned tour appears once with its date in words, and an empty list says "No planned tours." Past tours run newest first, read only, with when each happened and the properties visited when known. Tours copied from the old system show only as meetings in Activity, because the copy kept no mark that they were tours.
- [ ] Either partner can edit a planned tour. After saving and reopening it, both see the saved date, order and notes. A failed save keeps the edits and says what to fix. A save based on an older version offers to reload the tour.
- [ ] **Mark done** starts with the planned date and stops. The partner confirms the actual local date and time and the properties visited, and can omit a skipped stop or add one visited off-plan. The plan moves to past tours and one meeting appears in Activity, showing the visited properties. Marking it done again leaves one meeting.
- [ ] **Cancel tour** asks for confirmation. The plan leaves the planned list, the cancellation shows in Activity, and no meeting is added.
- [ ] A client's comment on a toured property or a shortlist change still appears on Home. Opening it shows the property and the saved feedback. **Done** finishes the review there.

See [Planned tours on a deal](../new-database.md#planned-tours-on-a-deal).

### Documents

- [ ] Documents show every file on the deal and open it on click for either partner. When old uploads contain identical bytes, the earliest filing appears once. Different files with the same name and kind show their version numbers in filed order.
- [ ] Adding a document uses a drop zone. A partner drops a file on it, clicks it, or reaches it by keyboard and presses Enter or Space. It takes one file at a time and shows the chosen file's name before upload.
- [ ] Either partner can open a document's extracted text. Pages appear in order, with blank pages in their original positions. If the file has no usable extracted text, the view says so. See the [deal document text read](../new-database.md#deal-files-and-extracted-text).
- [ ] Show sourced terms lists each lease term found in the deal's documents, with its document, pages and quoted text. Approve, Correct and Reject each take a reason. Terms waiting on a partner also show under Suggested on Overview.

### Client portal

- [ ] Client portal is the partners' view of what the client sees. A line at the top shows the site's name, when the client last opened it, **Copy client link** and **Open as client**. Open as client opens the site already unlocked in a new tab and never asks for a password. Under the line, the client's site shows as the client sees it.
- [ ] A deal with no website shows one line and **Build client website**.
- [ ] The new database keeps each deal's client website registration (owner, 2026-11-18, #728).

Coming later, once the engine can edit a site's contents: **Editing** puts a pencil and an x on every property and document, adds **+ Add a property** or **+ Add a document** to each section, and lets sections be reordered. With Editing off the page is exactly the client's view.

### On a phone

- [ ] The page is one column and scrolls, with 16px text and 44px buttons. The deal name comes first, then the facts line, then the tabs as one row that scrolls sideways with the chosen tab in view.
- [ ] Critical dates are one row that scrolls sideways. The path is one row that scrolls sideways and opens on the current phase. Next steps, Latest activity, Ask Doc to, Invoice, People and Park deal follow.
- [ ] Plan keeps the chart, with a narrower name column and no side list. It scrolls sideways, a tap opens a bar, and nothing drags.
- [ ] A phase click opens the same question as a sheet from the bottom. An Activity row opens full screen with Back. Tours shows the tour first, with its stops and **Generate tour packet**, then the properties.

## Questions for the owner

1. Answered on 2026-11-18 (#728). The new database keeps each deal's client website registration.
2. Answered on 2026-11-18 (#718): Checklist progress comes from the deal's saved facts after the switch. Pass D found zero document requests to move.
3. Answered on 2026-11-18. Copied automatic phase moves keep the “Moved automatically” mark on the deal page, with Undo for 7 days (updated 2026-11-20; owner ruling 2026-11-24). List shows the mark.
4. Answered on 2026-11-18. A person who is a client may belong to a national account.
5. Answered on 2026-11-19. When both partners have an open next step on one deal, the deal page shows both. The Board uses the deal owner's step to decide whether to show a late badge (updated 2026-11-20).
6. Answered on 2026-11-18, replaced on 2026-11-25. Doc builds the client website, so Set up client website is gone.
7. Answered on 2026-11-19, replaced on 2026-11-25. Compare LOIs on Overview takes the place of the Compare terms tab.
8. Answered on 2026-11-19, replaced on 2026-11-25. Every deal is watched, so deal watch settings leave the deal page. The call recorder stays.
9. Answered on 2026-11-18. For someone new, Add prospect requires one tap for person or company and one for how found on the add line.
10. Answered on 2026-11-18. A prospect is a lead at stage Opportunity that is on no deal. Adding a lead from the lane puts it at Opportunity.
11. Answered on 2026-11-19. Turn into deal opens Add deal with the prospect's name, newest note and claimed owner filled in. The partner sets the client, phase and owner before saving.
12. Answered on 2026-11-18. Both partners share one mark per deal or prospect per week. It shows who marked it, and either can Undo it.
13. Answered on 2026-11-18. Parked deals come last in the Monday review, after prospects.
14. Answered on 2026-11-18. Monday review replaces the old pipeline call sittings. The deal page keeps its call recorder.
15. Answered on 2026-11-25. The owner approved the deal page redesign with all 20 changes it proposed, including that the system, not a partner, sets Needs attention on a deal.

## Not yet true

Checked against app main on 2026-11-19. The new Deals paths depend on the switches in [The system](../system.md#switches).

- The deal page still shows deal watch settings, which save to the old database and cover only copied deals (#805).
- With the old read, the Documents tab's Deliverables section can say "Request unavailable or version changed" when it cannot list files (old system #3232). The tab also says "retained text" and "loaded documents".
- With the old read, email follow-ups can offer File to existing deal and New deal. They can also show "Sender unavailable", "Summary unavailable" or a role code such as `landlord_side`. The new read offers Accept and Dismiss when the new saves are on.
- With the old read, a critical date filed as Other can show a lowercase note as its label. The countdown still uses a bare day count for future dates, such as "864 days".
- With the new saves off, national account cards can show a client code and say "Sub-clients". A missing review time shows as "Last account review: not captured" on those cards.
- With the old read, Lost deals say "Not recorded" when the close date is missing. The new read says "Close date not recorded" and shows the reason when the deal has one.
- With the new saves off, regular Add deal still asks for "Type", labels the phase "Stage" and takes the client as "C-ref or exact client name".
- Closing on the old path still offers Paused. Phase moves still ask for "Evidence" and "In your words". The new save path calls the step "Your next step". The old path calls it "Next item (2–4 words)".
