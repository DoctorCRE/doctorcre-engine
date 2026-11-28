# Clients

The owner approved this design on 2026-11-25. Check each line on a signed-in app against the practice copy, at 1280x640 and 1440x900 on a computer and at 390px on a phone, with made-up data, with Color assist on and off.

## Opening tiles

- [ ] Clients opens on tiles. The top bar has the title, the client count, **Find a client**, the **All**, **Joe** and **Dell** chips, and **New client**.
- [ ] The tiles are **All clients**, then **National Accounts**, then one tile for each practice type that has at least one client, ordered from most clients to fewest, then **Other** and **Not set**. A practice type with no clients has no tile.
- [ ] **Other** holds clients who are not healthcare. It waits on the practice type list that marks which types are healthcare.
- [ ] **Not set** holds clients with no practice type. Inside it, **Set practice types** starts Doc. Doc proposes a practice type for each of those clients from its records and its doctors' specialties, and the partner approves the list.
- [ ] Each tile shows its total and three smaller counts: Open deal, Past client, and No deal yet. **All**, **Joe**, and **Dell** recount every tile.
- [ ] Clicking **All clients** opens the full table. Clicking a practice type tile, **Other**, or **Not set** opens that tile's table. Clicking **National Accounts** opens the National Accounts tiles.

## Inside a tile

- [ ] The top bar reads `Clients / ` and the tile name and its count, such as `Clients / Dental 64`. **Clients** goes back to the tiles. **Find in** and the tile name, such as "Find in Dental", narrows the table as the partner types.
- [ ] Beside the search, three chips filter by status: Open deal, Past client, and No deal yet. Each shows the tile's own count for that status, the same three counts the tile shows. A chip whose count is zero is left out. Clicking a chip shows only those clients, and clicking it again shows them all (coordinator, 2026-11-27).
- [ ] The columns are Name, Status, Open deal, Client type, Territory, Owner, and Updated. **All clients** also has a Practice type column. Inside a practice type tile or Not set, the Practice type column leaves. The header row stays in place while the table scrolls, and each row still reads its own labels. Each client is one line. Clicking Name, Status, Practice type, Territory, Owner, or Updated sorts by that column, and clicking it again returns to name order. Open deal and Client type do not sort.
- [ ] A client with an open deal shows the deal's name in Open deal, and the name opens the deal at `/deals?deal=<id>`. A client with no active deal has no deal link. The table and the card use Territory. The list shows recorded facts without an alarm badge for inactive clients or a list of blank fields.
- [ ] Filters apply as they change, so there is no Apply. When nothing matches, the table shows one line, such as "No clients match these filters", with **Clear all filters** when filters are on.
- [ ] On a computer the page does not scroll. The table scrolls inside itself under its header row. A row opens the client's card beside the table.

## National Accounts

- [ ] **National Accounts** opens a tile for each account, with its location count and its owner, plus an **All locations** tile.
- [ ] An account's tile opens the table of its locations. **All locations** opens the table of every location. Those locations are ordinary clients, so each also counts in its practice type or in Other.

## A client's card

- [ ] Clicking a row opens the client's card beside the table. The table stays, so the next client is one click away. The x closes the card. On a phone the card opens full screen.
- [ ] Under **Deals**, each of the client's deals has its own diagram, open deals first. A client with no deals has no Deals section. The deal's name above a diagram opens the deal.
- [ ] The card uses the glossary’s How found labels, including Not recorded. It shows clean North American phone numbers as `(202) 555-0100` and preserves other numbers and extensions. The card labels the owner.
- [ ] Notes expand with More when there is more to read. The view omits file citations. Details opens the record reference. An old record code in a note, such as `C-013`, reads as that record's name and opens it; one that matches no record reads "an old record".
- [ ] Recent activity starts with the newest few entries and expands with Show all. Each entry uses plain words without email addresses. An old record code such as `C-013` reads as that record's name. A recorded deal opens from the entry, and a saved email can be read from the entry.
- [ ] Recent activity shows, once each, the work filed to the client's deals and to a person's current companies or a company's current people. A person's coworkers at those companies are left out (coordinator, 2026-11-24). Current means as of the partners' Chicago day. An entry filed elsewhere names where: "on deal Example Suite Lease" for a deal, and just the name, such as "on Example Dental Group", for a company or person. A next step names its owner, such as "Joe’s step", so two partners' steps with the same words read as two steps (coordinator, 2026-11-24).
- [ ] A person who is both a client and a lead has one Recent Activity history. Either role reference opens that history.
- [ ] On engine sign-in, Closing anniversaries opens from More. It shows every closed-won deal whose closing anniversary falls within the next 30 Chicago days, with the client, deal, years and date. The client and deal names open those records. Blank names show Unnamed client or Unnamed deal. With no matches, it shows an empty state and the next anniversary date, if any. It offers retry on failure.
- [ ] **Edit** and **Link to someone** work as before.

## The deal diagram

- [ ] The top box is the client on that deal, including a linked company or person. The partner who owns the deal hangs off the client and says Deal owner. A vendor a partner introduced hangs off that partner. A vendor the client brought in hangs off the client, beside the partner. The introduction names the deal and its client as the maker.
- [ ] The diagrams come from the engine's one read of the client's deals, including deals of a person client's current companies and a company client's current people (`GET /api/engine/clients/{id}/deals`, [new-database.md](../new-database.md)).
- [ ] **Chosen** is green with a check. **Introduced** is gray with an open ring. A vendor turns green when it is added to the deal. Until then it stays gray. Each vendor shows its role first, such as "Lender · Chosen". Names on diagrams stay plain. The green is on the box and its check.
- [ ] Two or more introduced vendors under one box sit stacked like a solitaire pile behind the top card, with the card edges beneath visible and a count. One click fans them out. One click stacks them again.
- [ ] A vendor nobody recorded a source for hangs from a dashed line under "Brought in by: not recorded". It is never assumed to be the client's own. **Set** asks once per vendor whether Dell introduced them, Joe introduced them, or the client brought them.
- [ ] The diagram also shows a vendor who referred the client to us, and the other partner when he introduced someone on that deal.
- [ ] Clicking a vendor box shows who introduced them, when, and the note, with **Mark chosen**, **Open**, and **Remove from this deal**. **Mark chosen** puts the vendor on the deal in that role and turns the box green. **Add vendor** asks for the vendor, the role, and who brought them in: Dell, Joe, or the client. It needs no note, and the introduction is dated today in Chicago. **Not recorded** leaves the source unset.
- [ ] **Remove introduction** asks "Remove the introduction for [vendor] on [deal]?" before removing a recorded introduction. If the introduction has changed, reopen the box to review it. The vendor stays on the deal in any chosen roles. Email findings keep their source.
- [ ] When an **Add vendor** or **Set** save has no answer, the form says it could not confirm the save. Retrying recovers the earlier receipt. If the earlier source was saved and differs from the new choice, the form names the source it saved and asks the partner to use the new choice explicitly.
- [ ] The open icon on a deal shows the same diagram large, in place of the table, with dates under each name. The x returns to the table. The large view is for a computer only.

## On a phone

- [ ] Tiles are two across, with the name and the number. The page scrolls.
- [ ] A client's card opens full screen. The diagrams are the same trees at full width. Boxes are 44 px tall for a finger.

## Wiring

What draws each part today. App files are in `DoctorCRE/doctorcre-app`. A path under `/api/v1/business/` is the app's own route, and the app worker sends it on to the engine door beside it.

| Screen part                                               | App files                                                    | Engine doors                                                                                                                  | Tables                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Opening tiles, the table inside a tile, National Accounts | `js/workspace-business.js`, `js/workspace-business-model.js` | `/api/v1/business/clients` → `GET /api/engine/clients` (with `tiles=true` for the tiles)                                      | `party`, `party_role`, `client`, `client_vertical`, `client_type`, `client_status`, `national_account`, `client_brand`, `deal`    |
| A client's card                                           | `js/workspace-business.js`                                   | `/api/v1/business/clients/{id}` → `GET /api/engine/clients/{id}`                                                              | `party`, `client`, `party_email`, `party_phone`, `party_company`, `party_specialty`, `outside_id`, `active_do_not_contact` (view) |
| Recent activity                                           | `js/workspace-business.js`, `js/record-activity-model.js`    | `find-and-catch-up` → `GET /api/engine/recent-activity`                                                                       | `activity`, `activity_about`, `email`, `next_step`, `deal`, `party_company`                                                       |
| Closing anniversaries                                     | `src/ui/client-anniversaries.tsx`                            | `GET /api/engine/closing-anniversaries`, `GET /api/engine/closing-anniversaries/next`                                         | `deal`, `deal_phase_change`, `deal_party`, `party`                                                                                |
| **Edit** and **Link to someone**                          | `src/ui/party-editor.ts`                                     | `POST /api/engine/parties`, `POST /api/engine/clients/{id}`, `POST /api/engine/party-links`, `GET /api/engine/parties/search` | `party`, `party_role`, `client`, `client_vertical`, `party_link`, `change`                                                        |
| Deal diagrams and their open view                         | `src/ui/client-deals.tsx`, `src/ui/deal-diagram.tsx`         | `GET /api/engine/clients/{id}/deals`                                                                                          | `deal`, `deal_party`, `role`, `introduction`, `party`, `app_user`                                                                 |
| A vendor box: **Mark chosen**, **Remove from this deal**  | `src/ui/deal-vendor-menu.tsx`                                | `POST /api/engine/deals/{id}/parties`, `.../parties/remove`, `GET /api/engine/vendors/summary` for the roles                  | `deal_party`, `change`                                                                                                            |
| **Set** on a vendor box                                   | `src/ui/deal-vendor-menu.tsx`                                | `POST /api/engine/introductions` with `unrecorded_only`                                                                       | `introduction`, `deal_party`, `change`                                                                                            |
| **Remove introduction**                                   | `src/ui/deal-vendor-menu.tsx`                                | `POST /api/engine/introductions/{id}/remove`                                                                                  | `introduction`, `change`                                                                                                          |
| **Add vendor**                                            | `src/ui/deal-add-vendor.tsx`                                 | `GET /api/engine/vendors?q=`, `POST /api/engine/introductions`, `POST /api/engine/deals/{id}/parties`                         | `introduction`, `deal_party`, `change`                                                                                            |

Saves on a deal's vendors show only while the app's deal-saves and Clients and Vendors switches are on.
