# Glossary: Deals

The business's own words for the deal board and the deal page. DoctorCRE is a two-partner brokerage that finds and negotiates space for healthcare clients. The owner's wording is the authority. Where a screen and the database disagree, the screen's word wins. The database keeps its own names until the old system stops changing it (decision 1), so each term lists the names it matches today.

Each entry gives the meaning, the words to avoid, the database names, and the engine's name where it differs.

## People and companies

**Partner**:
One of the two partners, signed in to the app.
_Avoid_: actor
_Database_: `actor` (rows with `kind = 'human'`; the table also holds automations). Columns that name a partner hold the actor's `slug`: `deal.owner`, `v_deal_room_board.parked_by`, `account_owner`.
_New database_: a user (`app_user`).
_Engine_: `partner` in `src/session.ts`, `src/deals/routes.ts` and `readBoard`; the board answer keeps the old `actor` key.

**User**:
A person who uses the system: today the two partners, and any teammate added later. A user is a person in the party list, so they show on deals and timelines. Being a user is not a role on a deal; each deal's deal owner is a user.
_Avoid_: partner (in the new database), actor, member
_Database_: `app_user` in the new database, one row per user with their person's `party` id; `changed_by_user_id` names the user who last changed a row.

**Client**:
Any person or company we represent on a transaction.
_Avoid_: customer, party, account
_Database_: `client`, joined to `party` for its name; `client_name`, `client_ref` and `client_id` in the deal views.
_New database_: a party with the `client` role. Someone is a client as soon as a deal is opened for them, signed or not.

**Lead**:
A person or company we may represent, not yet a client. A lead whose deal opens becomes a client and keeps its lead history.
_Avoid_: prospect (a client status), contact
_Database_: `lead` today, with `client_id` pointing at a client it was linked to; a party with the `lead` role in the new database.

**Lead stage**:
Where a lead stands: New, Qualified, Outreach Active, Engaged, Nurture, Opportunity or Archived. Nurture replaces drip campaigns.
_Avoid_: phase (deals have phases), status
_Database_: `lead.stage` and `lead_stage` today; `party_role.stage` on the lead role and `stage` in the new database.

**Lead owner**:
The user who works a lead. A lead's territory does not decide it.
_Avoid_: assignee, territory owner
_Database_: `lead.owner_id` today; `party_role.owner_user_id` on the lead role in the new database.

**How found**:
How we found a lead or client. The choices are referral, vendor, marketing post, public records, cold outreach, own research, inbound, national account or corporate lead, existing relationship, and event. Not recorded is kept only for records copied from the old system.
_Avoid_: source on its own, lane (a radar lane), referral source
_Database_: `lead.source_type` and `client.acquisition_source` (shown as "Referral Source") today, both free text; `party.how_found` and `how_found` in the new database, with `party.how_found_detail` for attribution detail.

**Prospect**:
The stage in between lead and client. A lead becomes a prospect when it turns warm, or a potential client becomes one when introduced. It stays a prospect until we represent them. An inactive prospect goes back to Leads.
_Avoid_: lead (still on the Leads screen), on-deck client
_Database_: `client.status = 'prospect'` with `client.prospect_engagement_status` (`active` or `inactive`); `v_client_engagement_status`.
_New database_: no prospect status. Someone is a client once a deal is opened for them, and a deal in Prospective Client is not signed yet. On the Deals board, a prospect is recommended to be a lead at stage Opportunity on no deal yet, pending the owner (`docs/screens/deals.md` § "Prospects", question 10).

**National account**:
A franchise or multi-location brand that we serve as one main client. One partner is its account owner. Each location is a franchisee with its own deals. A deal outside our territory is likely a national-account deal.
_Avoid_: account client, parent client, brand, portfolio
_Database_: `client` with `client_type = 'national_account'`; `v_client_account.account_client_id`; `v_deal_room_account`; `national_account_owner`. The old Salesforce flag `deal.lane` (`territory` or `national`) can disagree with whether the client sits under a national account.
_Engine_: `account_client_id`, `account_name`, `account_owner`, and the `accounts` list on the board.

**Franchisee**:
One location under a national account. Its record is also called a location. Its deals attach to it, never to the brand.
_Accept_: location
_Avoid_: sub-client, child client, line item
_Database_: a `client` whose party's `org_id` points at the national account's organization; `v_client_account.is_sub_client`.

**Vendor**:
An individual or company who plays a role in the transaction or provides services to our clients: lender, contractor, architect, consultant, attorney, title, inspector, and so on. The deal shows each vendor's company and contact under its role.
_Avoid_: service provider, party, partner
_Database_: `vendor`; `deal_vendor_assignment.role`, whose check allows `lender`, `contractor`, `architect`, `attorney`, `title`, `inspector` and `landlord_rep` (no `consultant` yet); `v_deal_room_vendor`.
_Engine_: `vendors` on the board and the deal page.
_New database_: a party with the `vendor` role. Its category, such as lender, is a role too (see Vendor category).

**Vendor category**:
What kind of vendor someone is, such as lender, attorney or contractor. Never "misc": a rare kind gets its own category.
_Avoid_: vendor type
_Database_: `vendor.category_slug` and `vendor_category` today; in the new database, a role whose `category_of` is `vendor`, held in `party_role` and named on a deal in `deal_party`.

**Vendor stage**:
Where a vendor stands with the team, from a list the partners keep.
_Avoid_: status, phase (deals have phases)
_Database_: `vendor.stage` and `vendor_stage` today; `party_role.stage` on the vendor role and `stage` in the new database.

**Relationship level**:
How well the team knows a vendor: 0 Prospective, 1 Building, 2 Established, 3 Core. None means not yet judged.
_Avoid_: contact level, rating, tier
_Database_: `vendor.relationship_level` and `vendor_relationship_level` today; `party_role.relationship_level` and `relationship_level` in the new database.

**Disposition**:
The team's ruling on a vendor: active, parked (deliberately dormant, drip only) or avoid (ruled out as a partner). A parked or avoided vendor has a reason.
_Avoid_: stage, status
_Database_: `vendor.disposition` and `vendor_disposition` today; `party_role.disposition` and `party_role.disposition_reason` on the vendor role in the new database, where none is active.

**Target**:
A vendor the team wants to meet.
_Avoid_: target stage
_Database_: `vendor.is_target` today; `party_role.is_target` on the vendor role in the new database.

**Introduction**:
A vendor introducing someone to the team, or the team introducing someone to a vendor, and the deal it led to. One the team made names the user who made it.
_Avoid_: intro, link, referral (on its own)
_Database_: `party_link` and `party_link_deal` today, with `via_party` naming who made it; `introduction` in the new database, with `introduced_by_user_id` for a team's.

**Knows** and **can introduce**:
That one person or company knows another, or could introduce the team to another. Neither has happened the way an introduction has, and neither needs a vendor.
_Avoid_: introduction, intro, connection
_Database_: `party_link` of kind `knows` or `can_introduce` today, and `party_link` of the same two kinds in the new database.

**Track record**:
What a vendor's deals show: the deals it worked, how they ended, and the deals its introductions led to. It is read from deal history, never set by hand.
_Avoid_: rating, trust tier, score
_Database_: computed from `vendor.deal_evidence`, `party_link_deal` and `party_link` today; `vendor_track_record` in the new database.

**Listing agent**:
An agent or broker representing the property owner.
_Avoid_: listing side, landlord rep
_Database_: on a deal, `deal_participant` with role `listing_side`; on a building, `building_ownership.kind = 'listing_agent'`. The vendor role `landlord_rep` is a separate, similar role.

**Market agent**:
A Carr agent working a national-account deal in their local market.
_Avoid_: agent on its own, outside broker, referring agent (a different role on the deal)
_Database_: `deal_market_assignment.agent_name`.
_Engine_: `market_agent`.

**Party**:
The database's word for any person or organization record. Clients, vendors, leads and contacts each point at one. It is not a business word, so screens and new code say client, contact, vendor or company.
_Avoid_ on screens and in new code: party
_Database_: `party`, with `kind` `person` or `org`; refs printed as `P-…`.

## Deals

**Deal**:
One piece of brokerage work for one client, such as a lease, a purchase or a renewal. Its name on the board is a short name when the client is a doctor and the market is known, such as "Dr. Example's Springfield Deal".
_Avoid_: deal room (the old app's name), work record, record, deal space (in the old system that means a saved space search for a deal), transaction
_Database_: `deal`; `v_deal_room_board` and `v_open_deal_room_board` for open deals; `v_deal_board` for closed and lost deals; the other `v_deal_room_*` views for a deal's parts. The type is `deal.deal_type`, with labels in `deal_type_ref`.
_Engine_: `type` for the deal type; `short_name` for the name the board shows.
_New database_: `deal`, where the type is two facts, its kind and its reason.

**Deal kind**:
What kind of transaction a deal is: lease, purchase, sale-leaseback, build-to-suit or other.
_Avoid_: deal type, transaction type
_Database_: part of `deal.deal_type` today; `deal.kind` and `deal_kind` in the new database.

**Deal reason**:
Why the client is taking space: start-up, relocation, expansion, renewal or additional office.
_Avoid_: deal type, motive
_Database_: part of `deal.deal_type` today; `deal.reason` and `deal_reason` in the new database.

**Local deal**:
A deal whose client is not under a national account. The partners work these themselves.
_Avoid_: team deal, territory deal, workspace
_Database_: `workspace_kind = 'team'` in `v_deal_room_board` and `deal_review_session`.
_Engine_: `workspace: "team"` in `readBoard`.
_New database_: never stored. A deal is national exactly when its client is a location of a national account, and local otherwise.

**Deal board**:
The screen that lists every open deal by phase, with Local Deals and National Accounts tabs and separate lists of closed and lost deals.
_Avoid_: Deals board, pipeline, Kanban, Deal Room
_Database_: `v_open_deal_room_board`, `v_deal_board`, `v_deal_room_account`.
_Engine_: `readBoard` in `src/deals/board.ts`, answer `local-deals-board.v2`.

**Deal page**:
The screen for one deal: its phase, deal owner, next step, vendors, critical dates, lease, history and notes.
_Avoid_: deal room, record panel, deal detail, timeline
_Database_: the `v_deal_room_*` views for one `deal_id`.
_Engine_: `readDealDetail` in `src/deals/detail.ts`, answer `deal-timeline.v1`.

**Phase**:
Where a deal stands. There are eight, in order: Prospective Client, Research, Site Selection, Negotiating, Legal, Due Diligence, Closing, Closed.
_Avoid_: stage (leads have stages), column, status, On Deck, Pending, Diligence
_Database_: `deal.phase` and `deal_phase`, slugs `pending`, `research`, `site_selection`, `negotiation`, `legal`, `due_diligence`, `closing`, `closed`.

**Deal owner**:
The partner responsible for a deal.
_Avoid_: owner on its own, lead (a participant role that means deal owner), assignee
_Database_: `deal.owner` for open deals. Closed and lost deals take it from `deal_participant` with role `lead`, shown as `v_deal_board.lead_owner`.
_Engine_: `owner` in both places.
_New database_: `deal.owner_user_id`, exactly one user per deal; change history keeps earlier owners.

**Market**:
The city or metro area where the client needs space.
_Avoid_: territory, submarket
_Database_: `deal.city`, shown as `market` in `v_deal_room_board`.
_Engine_: `market` on the board; the deal page renames it back to `city`.
_Engine, new database_: `market` is an imported deal's recorded city until a user changes its market, and `market_id` is always the deal's named market, so a filter can match it.
_New database_: a named market (`market`), by the counties it covers, and `deal.market_id` for a deal's. A vendor's "market" is a whole territory, and a `market` row is one named piece of one.

**Territory**:
The area someone serves: a user's, a vendor's or a lead's. A vendor's market is its territory. It is made of whole states, named markets and distances from a base.
_Avoid_: market, for someone's whole area
_Database_: `vendor.territory` (text) and `vendor_market_membership` today; `territory`, `territory_piece` and `party_territory` in the new database.

**Critical date**:
A date in the deal or its lease that must not be missed, such as a due-diligence deadline or a lease expiration. In the new database it is proposed until a user confirms it; only a user resolves it.
_Avoid_: deadline, milestone, key date
_Database_: `critical_date`; `v_deal_room_critical_date`.
_Engine_: `critical_dates`.
_New database_: a partner's drop is `dropped` on `critical_date` and `cancelled` on `next_step`; both end the item without completing it.

**Parked**:
A deal that is not active work for now, with a reason. Parking keeps the deal; reviving it makes it active again. A paused deal is parked.
_Avoid_: on hold, inactive, archived, paused
_Database_: `deal.operating_state` (`active` or `parked`), `parking_reason` (`prospect_never_active`, `client_paused`, `other`), `parking_note`, `parked_at`, `parked_by`.
_Engine_: `operating_state`.
_New database_: `deal.parking_reason`, none when active, `deal.parking_note`, and who last parked it and when in `deal.parked_by_user_id`, `deal.parked_automatically` and `deal.parked_at`.

**Needs attention**:
A flag a user sets on a deal to say it needs a look. Nothing sets it on its own.
_Avoid_: flagged, urgent, priority
_Database_: `deal.attention` today; `deal.needs_attention` in the new database.
_Engine_: `attention`.

**Pipeline call**:
A sitting where a partner goes through the open deals and marks each reviewed or skipped.
_Avoid_: deal review, session, agenda
_Database_: `deal_review_session` and `deal_review_item`; `v_deal_room_session`; `last_review_at` in `v_deal_room_board` and `v_deal_room_account`.
_Engine_: `open_session` on the board.

**Monday review**:
The weekly pass over every open deal and prospect, marking each reviewed for that week.
_Avoid_: pipeline call (the old system's sitting), deal review
_New database_: `weekly_review`, one row per deal or prospect per week.

**Lease**:
A tenant's agreement for a property, whether negotiated by the team or elsewhere. Its sourced terms are versions; an amendment is the next version. The latest version is current. A renewal is a new deal linked to this lease.

**Lease option**:
A renewal, expansion or early termination right in one lease version, with its exact notice deadline and terms.

**Gross commission**:
What the brokerage collects on a deal, recorded once. Every share and payment is a part of it.
_Avoid_: fee, take (a user's part), commission amount on a payment
_Database_: `commission.gross_amount` today, one row per invoice; `commission.gross` in the new database, one per deal.

**Expected commission**:
What an open deal is expected to bring, before its gross is known.
_Database_: `commission` rows with status `expected` today; `commission.expected` in the new database.

**Payment**:
One part of a deal's gross as it is invoiced, falls due and is received, such as half at signing and half at move-in.
_Avoid_: invoice (the email that brings it), installment
_Database_: `commission` rows with status `invoiced` or `received` today; `commission_payment` in the new database.

**Split**:
Who gets what share of a deal's gross. Others are paid first: a referring agent, the brokerage, anyone else. The two users split what is left.
_Avoid_: allocation, partner split
_Database_: `commission_allocation` today, never filled; `commission_share` for the others and the view `commission_split` for everyone in the new database.

**Closing user**:
The user who closes a deal, its deal owner. Their ladder sets their part of what the others leave, and their partner takes the rest.

**Ladder**:
A user's tiers by their lifetime count of closed deals. Each tier starts at a count and runs until the next one, with the closing user's part, stepping down toward an even split. The count never resets. A single deal can override it. The real tiers are the partners' rows and never appear in this repo.
_Avoid_: schedule, plan, tier table
_New database_: `commission_tier`, keyed by the user and the count its tier starts from.

**Tour**:
A visit to properties. In the new database a completed tour is a meeting about the parties, with its deal and visited properties linked when known.

## Clients in the new database

**Client status** is active deal when a client has open work, past client after closed work when none is open, and otherwise its manual roster, cold, engaged or paused status. `client_status` derives it; `client.status` holds only the manual value.

**Brand membership** joins a person or company with a client profile to its brand company for dates in `client_brand`. A franchisee is a client of type franchise with its own deals. Rebranding ends the old membership and begins another.

**National account owner** is the partner responsible for the account, Joe or Dell. `national_account_owner` keeps dated ownership; a deal's owner is separate. `national_account` identifies the brand company, independently of client type.

**Lead stage evidence**:
An activity and its reference supporting a proposed or applied lead stage move. Weak job evidence waits for a user. Archiving always needs a user and a reason.
_New database_: `lead_stage_move`. Ordinary stage edits and who and when stay in `change`.

**Lead segment**:
The free-text board segment used to group leads.
_New database_: `party_role.segment` on the lead role.

**Lead lane**:
The kind of opportunity being worked, independent of how the lead was found.
_New database_: `party_role.lane` on the lead role, from `lead_lane`.

**Estimated lease date**:
A lead's expected lease event, with its source and optional confidence. It is an estimate, not an executed lease ending.
_New database_: `party_role.estimated_lease_on`, `lease_estimate_source` and `lease_estimate_confidence` on the lead role.

**Space need**:
A client's requirements on a deal, such as size, space type, market and must-haves. A deal may have several named alternatives.
_Database_: `space_need` in the new database; today's `space_search`, `ops.deal_space_search` and approved requirements in `deal_client_need` supply its mapping.

**Suite**:
Space within a building, with a label, floor and area when known. A lease can name a suite in its property.
_Database_: `suite` in the new database; `space` today.

**Building facts**:
A property's name, class, type, year built and stories, when known. Class and type are free text, as the old system kept them.
_Database_: `property.name`, `building_class`, `building_type`, `year_built` and `stories` in the new database; `building.name`, `class`, `sub_type`, `year_built` and `stories` today.

**Building owner**:
A person or company that owns a property, with dates when known. A building can have joint and former owners.
_Database_: `building_ownership` in both databases. The table also keeps property managers and listing representatives under their own kinds.

**Outreach draft**:
A lead's prepared first-contact message. Approval never sends it. A user sends it from their mailbox.
_New database_: `lead_contact_draft`, always human-send and never dispatchable. An edit clears approval and advances the revision.

**Reply draft**:
A job's reply to one email, which its owner reviews, edits and approves, and which their mailbox then sends at most once.
_New database_: `reply_draft`, with its delivery status: pending, dismissed, approved, sent or failed. Apart from outreach drafts.

**Candidate**:
An unreviewed sweep or public-record result kept outside the working contact list. A user promotes it to a lead, or declines it with a reason.
_New database_: `candidate`, retaining source context and qualification after promotion. A suppressed candidate waits for user review.
