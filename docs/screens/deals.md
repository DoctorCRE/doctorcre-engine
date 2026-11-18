# Deals

- **For** each partner, signed in, on a computer or a phone. Both partners see every deal, including its documents and its client view, whoever owns it.
- **Must** show every open deal once, in its phase, with its deal owner and one next step. Every card opens to its deal page. Every change a partner makes there saves to the new database, and each deal page opens that client's website.
- **Must never** show the same deal twice, a card that cannot be opened, an internal code, a raw timestamp or a system word. It never asks a partner for a client website's password, and it never saves anything without the partner's click.

The owner's test, in his words: "deal board+deal pages are fully built out, including being able to see the websites i build for each client". The roadmap's "done": the board and every deal page run on the new system, every change saves there, and each deal page shows that client's website. Each line below is checked on the real screen, signed in, against a copy of production. Examples use made-up names. Words follow `docs/glossary.md`.

## Everywhere on Deals

- [ ] Dates read as words in Central time: "Due Thu, Nov 19", "2 days late", "Moved automatically Mon, Oct 19". Never `2026-11-19` or `10/19`.
- [ ] No internal codes or system words: no `C-161`, "The Deal Room", "workspace", "loaded", "retained text", "portal", "CARR", "landlord_side", "Request unavailable or version changed".
- [ ] A section that has nothing says so in plain words. "Unavailable" shows only when a read really failed, with Retry.
- [ ] A save that crosses another partner's edit says so and offers to reload the deal. Nothing is overwritten without a click.

## Deal board

- [ ] Two tabs: Local Deals and National Accounts.
- [ ] All, Joe and Dell choose whose deals show. Board, List, Closed deals, Lost deals and Parked choose the view.
- [ ] Board: eight columns in order, Prospective Client, Research, Site Selection, Negotiating, Legal, Due Diligence, Closing, Closed. Each column says how many cards it holds.
- [ ] The headline counts exactly the cards shown: "38 open deals · 27 parked".
- [ ] Each open deal shows once, in its phase column. A parked deal shows only in the Parked lane.
- [ ] List: one row per open deal with its name, deal owner, phase and next step, the same as its card.
- [ ] Add deal asks for the deal name, the client (picked by name), the deal kind, the deal reason, the phase and the deal owner. Kind and reason may each be left unknown.

### Card

- [ ] The title is the deal's short name, such as "Dr. Example's Springfield Deal". Clicking it opens the deal page.
- [ ] Under the title, the deal owner, then the next step and its due date in words, the same step the deal page shows. "No next step set" when there is none.
- [ ] A late next step says how late: "Send the floor plan · 3 days late".
- [ ] Needs attention shows only when a partner set it on the deal.
- [ ] Client website shows when the deal has one and opens it as the deal page does.
- [ ] A phase move the system made shows "Moved automatically" with its date in words (see question 3).
- [ ] Dragging a card to another column, or the same move by keyboard, asks for the phase move's details and moves it only on Move.

### Moving a phase

- [ ] The move asks what changed, the next step and its date, and an optional critical date with where it came from. One next step per person: the new step replaces that person's open step on the deal.
- [ ] Moving to Closed asks Won or Lost, and the date. Won asks the closed value, which may be left empty until known and is never zero.
- [ ] Lost asks the reason and the date. A lost deal keeps everything and leaves the board for Lost deals.
- [ ] Setting a deal aside is Park, never a Paused outcome.

### Parked lane

- [ ] Each parked card shows the deal's name, deal owner, why it is parked (client paused, prospect never active, or the partner's note) and when.
- [ ] Clicking the title opens the deal page.
- [ ] Revive makes the deal active again in the phase it was in, and the card moves back to that column.

### Closed deals and Lost deals

- [ ] Each lists its deals with client, deal kind, deal owner and the close date in words. Lost deals also show the reason.
- [ ] Search finds deals by name, client, kind or close date.
- [ ] Each deal opens its deal page.

## National Accounts

- [ ] One card per national account: its name, its account owner, and how many open deals, late next steps and parked deals it has. No client codes.
- [ ] Opening an account lists its deals, one row per location deal: name, market, phase, next step and market agent.
- [ ] Every national-account deal shows under its account, never under Local Deals (see question 4).
- [ ] Each row opens the deal page. Park and the phase work as they do on the board.

## Deal page

The header shows the deal's name, client, phase, deal owner and next critical date, once each. Back to deals returns to the board where the partner left it.

### Overview

- [ ] Client website, near the top. For a signed-in partner it opens the client's site already unlocked, in a new tab. No password is shown, stored or asked for.
- [ ] A deal with no website says "No client website linked.", with Set up client website below the deal's facts.
- [ ] Next step: the same step and date as the card, with Change next step. Each person has at most one open next step on a deal. A step saved without an owner belongs to the partner who saved it.
- [ ] Facts: deal kind, deal reason, market, closed value when closed, and the market agent on a national-account deal.
- [ ] Phase, deal owner and Park, with the same rules as the board. Park asks the reason: client paused, prospect never active, or other with a note.
- [ ] Needs attention: a partner sets and clears it. Nothing sets it on its own.
- [ ] Checklist: the deal's checklist items, each with its state (see question 2).
- [ ] Critical dates: each with its name in plain words, its date in words and its state. A date read from a document is proposed until a partner confirms it.
- [ ] Update: a note saved to the deal's history with its author and time.
- [ ] Vendors on the deal, each opening its vendor page.

### Tabs

- [ ] Compare terms: the deal's offers and lease terms side by side, each value with where it came from.
- [ ] Timeline: every dated thing on the deal, newest first: phase moves, notes, next steps, critical dates and changes, each saying who and when in words.
- [ ] Correspondence & notes: the deal's emails and meetings together, newest first, each with sender, date and subject, and the deal's notes. An email already on this deal never asks to be filed again.
- [ ] Tours: the deal's tours, each with its date in words.
- [ ] Documents: every file on the deal, opening on click, for both partners on every deal.
- [ ] Client view: what the client sees on their website, and the files a partner chooses to share there, for both partners on every deal.

## Questions for the owner

These are roadmap asks 9 to 11 and 7, plus one the board raises. Each recommendation comes first.

1. Client website: the new database has no place yet for a deal's client website. Recommended: add one, so the deal page keeps its Client website link after the switch.
2. Checklist: the new database does not keep checklist progress (144 of 194 deals have a checklist). Recommended: add it, so the checklist shows on every deal page instead of "Checklist unavailable".
3. Moved automatically: the copy does not record which phase moves the system made (16 cards today). Recommended: keep that mark on copied moves, with Undo on the card.
4. 15 of the 16 national-account deals show under Local Deals because their client is a person. Recommended: let a person who is a client belong to a national account, so all 16 show under their account.
5. When both partners have an open next step on one deal, which shows on the card? Recommended: the deal owner's, with the other partner's step on the deal page.

## Not yet true

Seen on the live Deals screen on 2026-11-18, or read in the app's Deals code where noted.

- Every save on Deals goes to the old database. App #953 moves the saves to the new one, switched off until the switch; deal creation, closing and critical dates still have no new-database save.
- A deal page shows four open next actions, and an "Overdue action" different from the card's next step. The client shows twice, and website setup sits in the opening facts. App #950 fixes these.
- The deal page says "Watch state not confirmed" when nothing failed (app #932).
- Parked cards can be revived but not opened.
- "Moved automatically" shows `10/19`, and the card has no Undo.
- On a deal Dell owns, Joe's Documents tab says "Request unavailable or version changed" (old system #3232).
- Emails already on a deal ask "File email to this deal" with File to existing deal and New deal. Many say "Sender unavailable" or "Summary unavailable", and show role words such as `landlord_side`.
- Critical dates read "lease expiration estimated" and "864 days" in lower case.
- Documents and Client view use "Deliverables", "retained text", "0 matching of 0 loaded documents", "client portal" and "while CARR allows them".
- National Accounts is titled "The Deal Room", its tab reads "All Deals", and its account card shows `C-161`, "Sub-clients" and "Last account review: not captured".
- Lost deals show no reason, and most show "Close date: Not recorded" (roadmap ask 4).
- Add deal asks "Type", which mixes kind and reason, labels the phase "Stage", and takes the client as "C-ref or exact client name" (code).
- The phase move offers a Paused outcome, asks "Next item (2–4 words)", "Evidence" and "In your words", and its button reads "Move to the chosen column" (code).
- "Mark inactive" on a prospect deal has no place in the new database (`docs/new-database.md` § "Deals reads for the app").
