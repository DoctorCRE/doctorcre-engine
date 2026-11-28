# Vendors

- **For** both partners, on a computer or phone.
- **Must** show what kinds of vendors the team has, who covers a market, and where the team stands with each vendor, in two clicks.

The owner approved this design on 2026-11-25. Check each line on a signed-in app against the practice copy, at 1280x640 and 1440x900 on a computer and at 390px on a phone, with made-up data, with Color assist on and off. The reads behind it are in [Vendors redesign reads](../new-database.md#vendors-redesign-reads).

## Relationship

A vendor's relationship is read from its level, its ruling and its target flag. Nothing new is stored. A ruling outranks a level.

| Stored on the vendor                | Shown            | Color                | Shape            |
| ----------------------------------- | ---------------- | -------------------- | ---------------- |
| Ruling avoid, at any level          | **Avoid**        | Red                  | Circle and slash |
| Ruling parked, at any level         | **Parked**       | Gray                 | Pause bars       |
| Level 3, no ruling                  | **Core**         | Green                | Ringed dot       |
| Level 2, no ruling                  | **Established**  | Green                | Solid dot        |
| Level 1, no ruling                  | **Building**     | Yellow               | Half dot         |
| Level 0, no ruling                  | **Prospective**  | Blue                 | Open ring        |
| No level, no ruling                 | **Not rated**    | Plain                | Dashed ring      |
| Target, with any of these but Avoid | **Want to meet** | A tag after the name | None             |

- [ ] The vendor's name takes the color, its shape sits in front of the name, and the word sits in the Relationship column. Color is never the only signal.
- [ ] Each name color has a contrast of at least 4.5 against its row, in dark and light.
- [ ] The row, the card, the tiles and the counts all show the same relationship for the same vendor.
- [ ] Neither "Workable" nor "Not workable" appears anywhere on Vendors. "Disposition" and "Stage" are not shown. Stage stays stored and unused.

## Categories

Vendors opens on a tile for each vendor category.

- [ ] The top bar has the title, the vendor count, **Categories** and **People worth meeting**, **Find a vendor**, the **All**, **Joe** and **Dell** chips, **New vendor** and **Ask Doc**. On a phone the count is not shown, so the owner chips fit.
- [ ] **All vendors** is the first tile and **No category** the last. The category tiles between them are in alphabetical order. No category holds the vendors nobody has categorized.
- [ ] Each tile shows the category, its vendor count, and the count for each relationship. A tile with quiet vendors says how many at the bottom.
- [ ] A vendor with two categories counts under both tiles, so the tiles add up to more than the total. All vendors shows the true total.
- [ ] **Joe** or **Dell** recounts every tile for that partner's vendors.
- [ ] Typing in **Find a vendor** swaps the tiles for a table of matches from every category, with a Category column. Clearing the box brings the tiles back.
- [ ] Clicking a tile opens that category.
- [ ] **All vendors** opens the same table as a category, with a Category column.
- [ ] **People worth meeting** is unchanged.
- [ ] The Today panel starts collapsed on Vendors and remembers the partner's choice.

## Inside a category

- [ ] The top bar reads "Vendors / " and the category. **Vendors** goes back to the tiles. **Find in** and the category, such as "Find in Attorney", narrows the table as the partner types.
- [ ] No dropdown is on the screen. Category, Stage, Disposition, Sort, Territory, Reset and refresh are gone.
- [ ] The page does not scroll on a computer. The table scrolls inside itself under its header row. At 1280x640 with three rows of territory tiles, at least 11 whole vendor rows show.

### Territory tiles

- [ ] A row of territory tiles sits under the top bar: **All territories**, then one tile for each of the 19 markets that has a vendor in this category, west to east, then **Elsewhere** and **No territory**. Each tile has its count.
- [ ] A vendor is under every market its territory covers. A vendor whose territory covers a whole state is under every market in that state.
- [ ] **Elsewhere** holds vendors whose territory covers none of the 19 markets, including a typed territory not yet matched to markets. **No territory** holds vendors with no territory recorded.
- [ ] Clicking a territory tile leaves only the vendors under it. The table changes in place and the tile stays lit. Clicking it again, or **All territories**, brings everyone back.

### The table

- [ ] The columns are Name, Relationship, Territory, Location, Last contacted and Owner. The header row stays in place while the table scrolls. Screen readers skip it, and each row still reads its own labels.
- [ ] Each vendor is one line. A person's firm follows the name in small gray text, then the **Want to meet** tag. Referred, Worked and Win rate are on the card only.
- [ ] Territory is the vendor's own territory as written. Slash-joined territories wrap after a slash, never mid-word.
- [ ] The table is in relationship order, Core first and Avoid last, then by name. Clicking a column heading sorts by that column.
- [ ] A row above the table counts each relationship, such as "Core 2 · Established 5 · Building 4". Clicking one shows only those vendors. Clicking it again clears it.
- [ ] **Quiet** at the right end of that row shows only vendors with no contact in 90 days and no next step. Their last contact turns amber and says how long, such as "Aug 11 · 106 days". Clicking it again clears it. There is no separate quiet section, and no Hide or Refresh quiet vendors.
- [ ] Filters apply as they change, with no Apply.
- [ ] When nothing matches, the table shows one line, "No vendors match these filters", and **Clear filters**, which clears the territory, the relationship, Quiet and the search.

## A vendor's card

- [ ] Clicking a row opens the vendor's card beside the table. The table stays, so the next vendor is one click away. The x closes the card.
- [ ] The card shows the colored name with its shape, then the firm, the categories and the owner, labelled.
- [ ] The relationship is a button, such as "Building ▾". It lists the four levels and Not rated, then **Park** and **Avoid**, then **Want to meet**, which turns on and off. Park and Avoid ask for a reason before they save. The reason shows beside the button from then on.
- [ ] **Edit** and **Link to someone** work as before.
- [ ] Then the next step, Contacts & offices, Conversations, Relationships, Partnership (deals worked and referred, offers, seeking) and Where.
- [ ] **Relationships** starts with four counts: **Sent us**, **We sent them**, **Chosen**, and **Knows**.
- [ ] Relationships comes from the engine's one read of the vendor's relationships (`GET /api/engine/vendors/{id}/relationships`, [new-database.md](../new-database.md#vendors-redesign-reads)).
- [ ] The vendor is the top box. Named groups hang under it: **Relationship partner** (Joe or Dell), **Sent us**, **We sent them**, **On deals, source not recorded** as a dashed line, **Knows** with a diamond, and **Can introduce us to** with a dashed ring.
- [ ] **Sent us** shows each client the vendor referred. Green with a check names the deal the referral became, such as "Voss Dental, first office · Deal closed". Gray with an open ring says "No deal yet".
- [ ] **We sent them** shows each client a partner introduced to this vendor. Green with a check is **Chosen** on that deal. Gray with an open ring is **Introduced**.
- [ ] **On deals, source not recorded** shows deals the vendor worked where nobody wrote down who brought them. Those hang from a dashed line.
- [ ] **Knows** shows people and companies the vendor knows, each with a diamond. **Can introduce us to** shows an offer that has not happened yet, each with a dashed ring.
- [ ] Names on diagrams stay plain. The green is on the box and its check.
- [ ] The large view shows the same groups with **Sent us** on the left and **We sent them** on the right. The partner sits above and who they know sits below. That view is for a computer only.
- [ ] A vendor's Territory shows once, under Where.
- [ ] A person vendor is listed under Contacts & offices with their own phone, mobile and email. The card does not repeat Phone, Mobile or Email elsewhere. A contact shows Phone and Mobile as separate fields. A company vendor keeps its own company line.
- [ ] Contact status shows only when it is not Active, and reads "Nurture", "Paused" or "Do not contact", never the stored code.
- [ ] A section with nothing to show is not drawn. A vendor with no deal history and no note has no Partnership block. A deal count of zero is hidden, because the engine sends zero when no deal history is recorded.

Mail capture can save an unconfirmed introduction with source **Found in email**. The Relationships lists and counts include only confirmed introductions.

## On a phone

- [ ] One column, and the page scrolls. Text is 16px and every button is 44px.
- [ ] The category tiles are two across, each with its name, count and quiet count.
- [ ] Inside a category the territory tiles are one row that scrolls sideways, and so are the relationship counts.
- [ ] Each vendor is two lines: the colored name and its relationship word, then the territory and the last contact.
- [ ] A vendor's card opens full screen with the x at the top.

## What each control does

| Control                                       | What it does                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| A category tile                               | Opens that category                                                               |
| **Vendors** in the top bar                    | Back to the tiles                                                                 |
| **Find a vendor**                             | A table of matches from every category                                            |
| **All**, **Joe**, **Dell**                    | Counts and lists only that partner's vendors                                      |
| A territory tile                              | Shows only vendors under that tile. Click again to clear                          |
| A relationship count                          | Shows only vendors with that relationship. Click again to clear                   |
| **Quiet**                                     | Shows only quiet vendors. Click again to clear                                    |
| A column heading                              | Sorts by that column                                                              |
| A vendor row                                  | Opens the card beside the table                                                   |
| The relationship button on a card             | Changes the level, parks or avoids with a reason, or turns Want to meet on or off |
| **Draft email**                               | Starts or reopens the Doc chat for that vendor ([coming later](#coming-later))    |
| **Edit**, **Link to someone**, **New vendor** | As before                                                                         |
| **Clear filters**                             | Clears the territory, the relationship, Quiet and the search                      |

## Coming later

- [ ] **Draft email** is the one orange button on a vendor's card, and only there. It starts or reopens a Doc chat named "Email to" and the vendor. Doc reads the vendor, asks what the email is for, and shows a draft the partner can edit. The email sends from the partner's mailbox only after **Approve and send**, and is saved to the vendor's Conversations. It waits on Doc chats started from a button.
- [ ] For a firm with several contacts, Doc first asks who the email is for. With no email on file, the button's place shows "No email on file" and **Add email**, which opens Edit. A vendor marked Do not contact has no button, and the card shows the Do not contact line with its reason.
- [ ] Sending an email never changes the relationship. A partner changes it on the card.
- [ ] Enable the app's `vendor-territory-tiles` routing key after the engine market reads are available and typed territories are matched to markets.

## Wiring

| Screen part | App files | Engine doors | Tables |
| --- | --- | --- | --- |
| Category tiles and owner counts | `business.html`, `js/workspace-business.js`, `js/workspace-business-model.js` | `GET /api/engine/vendors/summary` | `party_role`, `role`, `app_user`, `activity`, `activity_about`, `next_step`, `do_not_contact` |
| Category table, search and Quiet | `js/workspace-business.js`, `js/workspace-business-model.js` | `GET /api/engine/vendors` | `party`, `party_role`, `role`, `app_user`, `outside_id`, `party_territory`, `territory`, `activity`, `activity_about`, `next_step`, `do_not_contact` |
| Territory tile counts and filtering | `business.html`, `js/workspace-business.js`, `js/workspace-business-model.js`, `css/workspace-business.css`, `src/worker.js` | `GET /api/engine/vendors/summary`, `GET /api/engine/vendors?markets=true` | `party_territory`, `territory`, `territory_piece`, `market`, `market_county` |
| Vendor card and relationship changes | `js/workspace-business.js`, `js/workspace-business-model.js` | `GET /api/engine/vendors/{id}`, `POST /api/engine/vendors/{id}` | `party`, `party_role`, `party_email`, `party_phone`, `party_company`, `party_territory`, `territory`, `vendor_track_record`, `do_not_contact` |
| Relationships diagram | `src/ui/vendor-relationships.tsx` | `GET /api/engine/vendors/{id}/relationships` | `party`, `party_role`, `app_user`, `introduction`, `deal`, `deal_party`, `party_link` |

## Meeting planner

Research shows vendor contacts and their possible meetings. For a person with a vendor role, it shows that person. For a company with a vendor role, it shows the people with open company links, or a row with no contact. Each vendor link uses the party ID. Copied vendors keep their recorded vendor ref.

Search covers the vendor ref, contact and company names, category, service territory, and contact city. Contact state is outside the search because the new database does not store it. Pages follow the vendor and contact IDs. Start a new search after records change.

The planner drops the outside-market warning because no production vendors used the flag and the new database does not carry it over.

A possible meeting comes from the signed-in partner's stored Outlook agenda. Its organizer or an attendee must match the contact's email exactly after normalization. Research still shows contacts when the calendar is unavailable.

The new database has no verified office findings for vendor contacts. The planner serves only Research and refuses Suggested like any unknown view. Research keeps the existing missing-office label.
