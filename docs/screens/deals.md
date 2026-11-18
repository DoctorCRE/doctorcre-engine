# Deals

- **For** each partner, signed in, on a computer or a phone. Both partners see every deal, including its documents and its client view, whoever owns it.
- **Must** show every open deal once, in its phase, with its deal owner and one next step. Every card opens to its deal page. Every change a partner makes there saves to the new database, and a deal with a client website opens it from its deal page.
- **Must never** show the same deal twice, a card that cannot be opened, an internal code, a raw timestamp or a system word. It never asks a partner for a password to open a client's website. It never saves a partner's edit or decides a suggestion without that partner's click. What changes by itself, such as a phase move from a call or an invoice that closes a deal, shows as automatic, never as a partner's click.

The owner's test, in his words: "deal board+deal pages are fully built out, including being able to see the websites i build for each client". The roadmap's "done": the board and every deal page run on the new system, every change saves there, and each deal page shows that client's website. Each checkbox line is checked on the real screen, signed in, against a copy of production. Lines marked **Open** wait on an owner question below and are not checked until he answers. Examples use made-up names. Words follow `docs/glossary.md`.

## Everywhere on Deals

- [ ] Dates read as words in Central time: "Due Thu, Nov 19", "2 days late", "Moved automatically Mon, Oct 19". Never `2026-11-19` or `10/19`.
- [ ] No internal codes or system words: no client, lead or vendor codes, "The Deal Room", "workspace", "loaded", "retained text", "portal", "CARR", "landlord_side", "Request unavailable or version changed".
- [ ] A section that has nothing says so in plain words. "Unavailable" shows only when a read really failed, with Retry.
- [ ] If someone else saved the same field since the partner opened the deal, the save says so and offers to reload the deal. Nothing is overwritten.

## Deal board

- [ ] Two tabs: Local Deals and National Accounts.
- [ ] All, Joe and Dell choose whose deals show. Board, List, Closed deals and Lost deals choose the view. Parked shows or hides the Parked lane on Board and List.
- [ ] Board: seven columns in order, Prospective Client, Research, Site Selection, Negotiating, Legal, Due Diligence, Closing. Each column says how many cards it holds, collapsed or not. A closed deal leaves the board for Closed deals or Lost deals.
- [ ] The headline counts every open deal, including those in collapsed columns, and every parked deal, whether the Parked lane is open or not: "38 open deals · 27 parked".
- [ ] Each open deal shows once, in its phase column. A parked deal shows only in the Parked lane.
- [ ] List: one row per open deal with its name, deal owner, phase and next step, the same as its card.
- [ ] Add deal asks for the deal name, the client (picked by name), the deal kind, the deal reason, the phase and the deal owner. Kind and reason may each be left unknown. When the reason is renewal, it also asks which existing lease the deal renews, and saves only with one.

### Card

- [ ] The title is the deal's short name, such as "Dr. Example's Springfield Deal". Clicking it opens the deal page.
- [ ] Under the title, the deal owner, then a next step and its due date in words. "No next step set" when the deal has none.
- **Open (question 5).** When both partners have an open next step on the deal. Recommended: the card shows the deal owner's.
- [ ] A late next step says how late: "Send the floor plan · 3 days late".
- [ ] Needs attention shows only when a partner set it on the deal.
- [ ] Client website shows when the deal has one and opens it as the deal page does.
- [ ] A phase move made automatically, by a call or an invoice, shows "Moved automatically" with its date in words.
- **Open (question 3).** Moves copied from today's system. Recommended: they keep the "Moved automatically" mark, with Undo on the card. Otherwise they read as ordinary moves.
- [ ] Dragging a card to another column, or the same move by keyboard, asks for the phase move's details and moves it only on Move to [phase].

### Moving a phase

- [ ] The move asks what changed, the next step and its date, and an optional critical date with where it came from. The new step replaces the partner's own open next step on the deal, not counting checklist items.
- [ ] Closing a deal, from its deal page, asks Won or Lost, and the date.
- [ ] Won asks the closed value, which may be left empty until known and is never zero. The deal leaves the board for Closed deals.
- [ ] Lost asks the reason and the date. The deal keeps everything and leaves the board for Lost deals.
- [ ] Setting a deal aside is Park, never a Paused outcome.

### Parked lane

- [ ] Each parked card shows the deal's name, deal owner, why it is parked (client paused, prospect never active, or other), the partner's note when there is one, and when it was parked.
- [ ] Clicking the title opens the deal page.
- [ ] Revive makes the deal active again in the phase it was in, and the card moves back to that column.

### Closed deals and Lost deals

- [ ] Each lists its deals with client, deal kind, deal owner and the close date in words. A deal with no recorded close date says "Close date not recorded". Lost deals also show the reason.
- [ ] Search finds deals by name, client, kind or close date.
- [ ] Each deal opens its deal page.

With the new read, Closed deals shows "Closed automatically: Invoice received" with an `11/17`-style date when the nightly invoice job closed the deal.

## Prospects

A prospect is someone who may become a deal but is not one yet. The owner's words: the old spreadsheet worked because "it didn't block us from typing out a quick note or adding something in", and a lead once slipped for one to two months because it had no place to live.

- **Open (question 10).** Which leads are prospects. Recommended: a lead at stage Opportunity that is on no deal yet.

### Prospects lane

- [ ] Local Deals' Board shows a Prospects lane before Prospective Client, with its count. List shows the prospects after the deals, one row each.
- [ ] The headline counts them: "38 open deals · 27 parked · 9 prospects".
- [ ] All, Joe and Dell show the prospects that partner claimed. An unclaimed prospect shows under all three.
- [ ] Each card shows the name, who claimed it or "Unclaimed", the newest note's first line with who wrote it and when in words, and the soonest open follow-up with whose it is, such as "Joe · Due Thu, Nov 19", or "No follow-up set". A late follow-up says how late.
- [ ] Needs attention shows when a partner set it, as on a deal card. It is the owner's "highlight".
- [ ] Order: Needs attention first, then by that follow-up date, soonest first, then those with none, newest first.
- [ ] Clicking the name opens the prospect.

### Adding a prospect

- [ ] Add prospect is one line at the top of the lane: a name, then an optional note. Enter saves.
- **Open (question 9).** What else that save needs for someone new. Recommended: one tap each on the same line for person or company and for how found, both required. Nothing else is asked.
- [ ] It is never refused because the person or practice is not a client or not in the system yet. A blank name, or a save that fails, keeps the line open with the typed name and note and says what is missing or what went wrong.
- [ ] While the partner types, people and companies already in the system with that name are offered. Picking one puts it in the lane, asking how found only when it has none. Picking a prospect already in the lane adds the note to it. Picking a client offers Add deal for them instead.
- [ ] A new prospect is unclaimed until a partner clicks Claim (owner, 2026-11-18: leads "go to no one until they are claimed").

### A prospect

- [ ] Shows the name, how found, who claimed it, Needs attention, each partner's open follow-up and the notes.
- [ ] The note box is at the top. Enter saves the note; there is no Save button.
- [ ] Notes run newest first, all of them, including those from before it was a prospect, each saying who wrote it and when in words: "Dell · Mon, Nov 16, 9:40 AM".
- [ ] With both partners on the same prospect, a note one saves shows on the other's screen within five seconds, with no reload. Checked with both partners signed in side by side.
- [ ] Follow-up takes a date and a few words, such as "Call back about the second location". It is the setting partner's next step on this lead: it replaces their open step on it, including an automatic check-in, which stays in history as replaced. Mark done on Home finishes it.
- [ ] Home shows a due follow-up as a step for the partner who set it. Opening it on Home opens this prospect with the follow-up in view.
- [ ] Needs attention: a partner sets and clears it. Nothing sets it on its own.
- [ ] Claim makes the signed-in partner its owner. The owner can be changed to the other partner or back to Unclaimed.
- **Open (question 11).** Turn into deal. Recommended: it opens Add deal with the deal name, the newest note and the claimed owner filled in. Client, phase and owner must still be set there; the client may be this prospect or another, such as the practice a doctor runs. On save the deal opens and the prospect leaves the lane, its notes kept on its history.
- [ ] Drop asks a reason and takes it off the lane. It stays a lead, archived with that reason, on the Leads screen.
- [ ] If the other partner saved the same field since the prospect opened, the save says so and offers to reload. Nothing is overwritten.

## Monday review

The owner's words: every Monday they went over "all the deals we had, all the potential deals that werent yet technically a deal".

- [ ] Monday review opens from the Deals board on any day and covers the week that began that Monday, in Central time.
- [ ] It covers every open deal on Local Deals and National Accounts and every prospect, whoever owns or claimed it. The board's All, Joe and Dell choice and its collapsed columns do not narrow it.
- [ ] Order: deals by the phase each was in when the week began, in board column order, then by name; then prospects, oldest added first. Items that arrive during the week join at the end. A phase move, a new follow-up or Needs attention never moves an item.
- [ ] A prospect turned into a deal this week stays in its place as that deal, with its mark. A deal closed or lost and a prospect dropped this week stay in place, saying so, so the count holds.
- **Open (question 13).** Parked deals. Recommended: they come last, after the prospects.
- [ ] The top says how far along it is: "31 of 47 reviewed this week". Not reviewed only hides the reviewed ones.
- [ ] One at a time shows one deal or prospect: its name, owner, phase or "Prospect", Needs attention, next step or follow-up, its latest notes and the note box. Next and Back move through the list.
- [ ] As a list shows the same items, one row each, with the note box and the next step or follow-up opening in place.
- [ ] Change next step on a deal and Follow-up on a prospect save as they do on the deal page and the prospect. A note saved here shows on the other partner's open review within five seconds, as on a prospect.
- [ ] Reviewed marks the item reviewed this week, saying who and when, and goes to the next. Undo removes the mark, also after a reload.
- [ ] Opening a name goes to the deal page or the prospect. Back returns to the same place in the review.
- **Open (question 12).** Whether a mark is shared. Recommended: one mark per item per week, shared by both partners, either of whom can Undo it.
- **Open (question 14).** Whether Monday review replaces the pipeline call recorder. Recommended: yes.

## National Accounts

- [ ] One card per national account: its name, its account owner, and how many open deals, late next steps and parked deals it has. No client codes.
- [ ] Opening an account lists its deals, one row per location deal: name, market, phase, next step and market agent.
- [ ] National-account deals whose client is a person show under their account (owner answer, 2026-11-18).
- [ ] Each row opens the deal page. Park and the phase work as they do on the board.

## Deal page

The header shows the deal's name, client, phase, deal owner and next critical date, once each. Back to deals returns to the board where the partner left it.

### Overview

- [ ] Client website, near the top, when the deal has one. For a signed-in partner it opens the client's site already unlocked, in a new tab, and asks for no password.
- [ ] A deal with no website says "No client website linked."
- **Open (question 6).** How a partner links a new client website. Recommended: keep Set up client website below the deal's facts.
- [ ] Next steps: each person's open next step on the deal, with its owner and due date in words. A Home card for one of them opens here with that step in view.
- [ ] Change next step saves the partner's new step and date, replacing their own open step. A step saved without an owner belongs to the partner who saved it.
- [ ] Facts: deal kind, deal reason, market, closed value when closed, and the market agent on a national-account deal.
- [ ] Phase, deal owner and Park, with the same rules as the board. Park asks the reason (client paused, prospect never active, or other) and takes an optional note.
- [ ] Needs attention: a partner sets and clears it. Nothing sets it on its own.
- [ ] Checklist: the deal's checklist items, each with its due date in words. Clicking one opens it.
- [ ] Checklist progress shows the lease, invoice and commission facts recorded on the deal, and which confirmed dates are due.
- [ ] Critical dates: each with its name in plain words, its date in words and its state. A proposed date, such as one read from a lease, shows Confirm and Drop. Confirm makes it a confirmed date. Drop asks a reason. A confirmed date can be marked done, dropped or passed, each with a reason. Only a partner's click decides.
- [ ] Terms: Show sourced terms lists each lease term found in the deal's documents, with its document, pages and quoted text. Approve, Correct and Reject each take a reason and save the partner's choice, as on Home's lease fact card.
- [ ] Email follow-ups: each suggestion from an email on this deal, with that email. Accept and Dismiss work as on Home's email suggestion.
- [ ] Update: a note saved to the deal's history with its author and time.
- [ ] Vendors on the deal, each opening its vendor page.
- **Open (question 8).** Deal watch settings and the pipeline call recorder. Recommended: keep both as they work today.

### Tabs

- [ ] Compare terms: recorded terms from deals in the same submarket and use type, each value with where it came from.
- **Open (question 7).** Whether Compare terms becomes a side-by-side of this deal's own offers. Recommended: keep today's comparison until the owner decides.
- [ ] Timeline: every dated thing on the deal, newest first: phase moves, notes, next steps, critical dates and changes, each saying who and when in words.
- [ ] Correspondence & notes: the deal's emails and meetings together, newest first, and the deal's notes. An email shows its sender, date and subject. A meeting shows its title and time. An email already on this deal never asks to be filed again.
- [ ] Tours: the deal's tours, each with its date in words.
- [ ] Documents: every file on the deal, opening on click, for both partners on every deal.
- [ ] Client view: what the client sees on their website, for both partners on every deal. Sharing files to the client's website is not part of it: the owner dropped it (`docs/new-database.md` § "Deal files and extracted text").

## Questions for the owner

Questions 1 and 3 are roadmap asks 9 and 11. Question 9 is the roadmap ask "one tap for each on the add line". Each recommendation comes first.

1. Client website: the new database has no place yet for a deal's client website. Recommended: add one, so the deal page keeps its Client website link after the switch.
2. Checklist progress comes from the deal's saved facts after the switch. Pass D found zero document requests to move (#718).
3. Moved automatically: the copy does not record which phase moves the system made (16 cards today). Recommended: keep that mark on copied moves, with Undo on the card.
4. Answered on 2026-11-18. A person who is a client may belong to a national account.
5. When both partners have an open next step on one deal, which shows on the card? Recommended: the deal owner's, with both steps on the deal page.
6. Setting up a client website: today's Set up client website form asks for a website name and a password. How should a partner link a new site? Recommended: keep that setup, below the deal's facts.
7. Compare terms compares recorded terms across deals in one submarket and use type. Should it compare this deal's own offers instead? Recommended: keep today's comparison until you decide.
8. The deal page has deal watch settings, which choose whether the deal's changes reach Home, and the pipeline call recorder, whose proposed items each wait for Confirm or Skip. Recommended: keep both as they work today.
9. Adding a prospect for someone new: the one line gives a name and an optional note, but the database requires a real person-or-company and how found on every lead (rules 4 and 63, #604). Recommended: one tap each on the add line, both required, so the save never loosens a rule. Otherwise a prospect is saved without them, which loosens those rules. Until you answer, the save for someone new is not built.
10. Which leads show as prospects? Recommended: a lead at stage Opportunity that is on no deal yet. Adding one from the lane puts the lead at Opportunity, and leads at earlier stages stay on Leads until a partner moves them. Otherwise every open lead shows in the lane, including the 126 leads nobody has claimed.
11. How does a prospect become a deal? A deal needs a client, a phase and an owner, which a prospect does not have. Recommended: Turn into deal opens Add deal filled in from the prospect (name, newest note, claimed owner), and the partner sets client, phase and owner there before it saves. Otherwise one click makes the deal with set defaults, which would guess the phase and the client.
12. Is a Monday review mark shared? Recommended: one mark per deal or prospect per week, shared by both partners, saying who marked it, and either can Undo it. Otherwise each partner keeps their own marks.
13. Should parked deals be in the Monday review? Recommended: yes, last, so nothing parked is forgotten. Otherwise only active deals and prospects.
14. Does Monday review replace the old system's pipeline call sittings? Their three sittings marked no deal reviewed. Recommended: yes; the deal page's pipeline call recorder stays as question 8 says. Otherwise both run side by side.

## Not yet true

Seen on the live Deals screen on 2026-11-18 (screen), or read in the app's Deals code (code).

- Every save on Deals goes to the old database (code). App #953 is a partial move to the new one, switched off until the switch. The engine has saves for participant changes and critical dates (`docs/new-database.md` § "Deals participants and critical dates"). App #953 still needs to call them. Deal creation and closing still have no new-database save.
- A deal page shows four open next actions, and an "Overdue action" different from the card's next step. The client shows twice, and website setup sits in the opening facts (screen).
- The deal page says "Watch state not confirmed" when nothing failed (screen).
- App #950, in review, shows one next step and hides the watch line until the watch is read. It shows the client once and moves website setup below the snapshot. Its board and deal page still choose the next step from different inputs, so they can differ (code).
- A parked card's title is not a link or button. The card opens on a click outside its buttons, or on Enter or Space when focused (code).
- "Moved automatically" shows `10/19`, and the card has no Undo (screen).
- Copied phase moves show no automatic mark in the new read.
- On a deal Dell owns, Joe's Documents tab says "Request unavailable or version changed" (screen, old system #3232).
- Email follow-ups on a deal page offer "File email to this deal", with File to existing deal and New deal. Many say "Sender unavailable" or "Summary unavailable", and show role words such as `landlord_side` (screen).
- Critical dates read "lease expiration estimated" and "864 days" in lower case (screen).
- Documents and Client view use "Deliverables", "retained text", "0 matching of 0 loaded documents", "client portal" and "while CARR allows them" (screen).
- National Accounts is titled "The Deal Room", its tab reads "All Deals", and its account card shows a client code, "Sub-clients" and "Last account review: not captured" (screen).
- Lost deals show no reason, and most show "Close date: Not recorded" (screen, roadmap ask 4).
- Add deal asks "Type", which mixes kind and reason, labels the phase "Stage", and takes the client as "C-ref or exact client name" (code).
- The phase move offers a Paused outcome, and asks "Next item (2–4 words)", "Evidence" and "In your words" (code).
