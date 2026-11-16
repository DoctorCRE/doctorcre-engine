# The new database

The engine will move to a new, cleanly connected database in one planned step, after it serves every screen from today's database. This note designs the core. `schema/next.sql` holds the first slice. Tests load it into its own namespace in a throwaway database with made-up data. Nothing applies it to a live database.

## Records

- **`party`**: every person and company, once, each with its own id. `kind` is `person` or `company`. A person's `npi` is their individual NPI, and a company's its organization NPI. `how_found` says how a lead or client was found.
- **`merged_party`**: what a merged-away duplicate leaves behind: its old id and the record it became. Nothing lists or shows it.
- **`app_user`**: each person who uses the system, today the two partners, one row each with their person's id. `user` is a reserved word in PostgreSQL. A user still shows on timelines and deals as their person. Each user's preferences and facts will be columns here, or a child table keyed by the user, as they come.
- **`job`**: the short list of automatic jobs that change rows, such as the mail capture and the publisher, by slug and label.
- **`do_not_contact`**: a person or company nobody may reach out to, in any role, with the reason and an optional until-date.
- **`specialty`**: the list of a doctor's specialties, such as general dentistry. Like roles, a label can be renamed.
- **`outside_id`**: another system's id for a person, company or deal, such as a Salesforce or roster id, kept as import history.
- **`role`**: the short list of roles, such as client, lead, vendor, lender, listing agent and property owner. A user can rename a label without touching any record. A vendor's category, such as lender, is a role whose `category_of` is vendor.
- **`stage`**: each role's list of stages, such as a vendor's or a lead's. Like roles, a label can be renamed.
- **`how_found`**: the short list of how a lead or client was found, such as referral or public records. Like roles, a label can be renamed.
- **`relationship_level`**: the four levels of how well the team knows a vendor, from 0, Prospective, to 3, Core.
- **`introduction`**: one introduction between a vendor and the team, made either way, and the deal it led to.
- **`property`**: a building or space, by address, with its county and its point on the map once geocoded.
- **`market`**: a named market, such as a metro area, by the counties it covers (`market_county`).
- **`territory`**: the area someone serves, as a set of `territory_piece` rows.
- **`deal`**: one piece of brokerage work, with its kind, its reason, its deal owner, its market, its closed value, why it is parked, if it is, and whether it needs attention.
- **`deal_kind`**: the list of kinds of transaction, such as lease and purchase. Like roles, a label can be renamed.
- **`deal_reason`**: the list of reasons a client takes space, such as a start-up or a relocation. Like roles, a label can be renamed.
- **`phase`**: the list of deal phases, from negotiating to closed, plus dead. Like roles, a label can be renamed.
- **`deal_phase_change`**: one row each time a deal changes phase, with when, the new phase and the reason. A deal's phase is its latest row.
- **`offer`**: one round of an LOI or other offer on a deal.
- **`lease`**: a sourced version of a signed lease on a deal and property.
- **`lease_option`**: one option in a lease version, with its notice deadline and terms.
- **`critical_date`**: a proposed deadline, with its user confirmation and resolution.
- **`document`**: a file, as its name, its key in object storage (Cloudflare R2) and its type, read from the file's own bytes when the engine stores it. The file itself is never in the database. An email attachment names the email it arrived with.
- **`activity`**: something that happened: an email, a call, a meeting or a note, with when, who it came from and a summary.
- **`email`**: the email behind an email activity.
- **`next_step`**: what is due next, with its owner, due date and the time it was done.
- **`commission`**: a deal's commission, once: what an open deal is expected to bring, the gross the brokerage collects, and the closing user's part on this deal when it overrides their ladder.
- **`commission_payment`**: one part of the gross, with when it was invoiced, falls due and was received.
- **`commission_share`**: what goes to someone other than the users, such as a referring agent or the brokerage, as a share of the whole.
- **`commission_tier`**: one tier of a user's ladder: the count of closed deals it starts from, the closing user's part and their partner.
- **`change`**: one row for each insert, update or delete of a row above, with who made it and when.

Each record and link carries `created_at`, when its row was stored, so moving today's records across can keep their dates. Lists such as roles and phases do not, and neither do rows that carry their own time: activities and their emails, rounds, phase changes, posts and readings. An outside id has none either; only a merge changes it, so its stamp's time is when it was imported or last merged.

## Users, jobs and who changed what

Every row a person or a job changes says who last added or changed it, and `changed_at`, when. A person's change sets `changed_by_user_id`. A job's change sets `changed_by_job` instead, and `changed_for_user_id` when it worked for a user, so a person's change is always told from a job's (decision 35). A row names a user or a job, never both and never neither. These rows are the lists of roles, stages, phases, deal kinds, deal reasons, specialties and how found, parties, their merged-into pointers, and their emails, phone numbers, roles, companies, specialties and do-not-contact rows, outside ids, properties, markets and their counties, territories, their pieces and who serves them, introductions, deals and their phase changes, properties and parties, rounds and their documents, leases and their options, documents, activity and what it is about, emails, next steps, social accounts, ideas, design templates, posts and their text, media and reviews, readings, and commissions, their payments and shares, and ladder tiers.

The engine names who acts once per transaction, never for the whole connection, because a pooled connection serves the next user. A user's save sets `set_config('engine.user_id', <user id>, true)`. A job's save sets `set_config('engine.job', <slug>, true)`, and `engine.user_id` too when it works for a user. A trigger writes the stamp on every insert and update, whatever the statement says, and refuses the change when it names neither. A statement that changes nothing keeps the row's stamp, so a final post stays as it was. A name that is not a user or a job is refused by its key. A removal names who made it too, in change history.

The jobs today:

| Job            | Writes                                                                         | Works for                      |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------ |
| `intake`       | posts, their text and media, and their files' documents, from the Friday batch | no one                         |
| `mail_capture` | emails, their activity and what it is about, and attachments                   | the user whose mailbox it read |
| `publisher`    | a post's claim and its published or failed status                              | no one                         |
| `readings`     | readings                                                                       | no one                         |
| `review_close` | no response, when review closes                                                | no one                         |
| `agent`        | whatever an agent session saves                                                | the user it works for          |
| `old_system`   | rows the old system's own migrations and exporters last changed                | no one                         |

A user who settles a post stuck in `publishing` is named on the post. In marketing, a text edit, an edit's review and a cancel name a user, as the one who made it or the one a job worked for, and no response is a job's for no one. A sign-in names its user.

Only the owner adds a user or a job, because every change is signed with one. A user who has changed anything stays, so who changed what survives; a teammate who leaves will be a column on the user. Adding a teammate is a person row and a user row. The first user's own person row names them as its author, so that key is checked when the transaction ends. Being a user is not a role on a deal. A deal names its one deal owner, a user, on the deal itself (see "Deals").

Today's actors map across like this. The old `actor` table holds the two partners as `human`, the scheduled jobs and agent sessions as `automation`, and migrations and exporters as `system`. Its `created_by` and `updated_by` columns name an actor and are often empty, and the old `event` rows add a cause and, for an agent, the partner it worked for. Each `human` actor becomes a person with a user row. The owner loads them with the `stamp_change` triggers turned off, so a row keeps its old author and time: its author from `updated_by`, or `created_by` when never updated, and `changed_at` from `updated_at`, or `created_at`. The check that a row names a user or a job still holds during that load. A row a `human` actor last changed names that user. A row an `automation` actor last changed names the job that now does its work, such as `mail_capture` for the old mail filing, or `old_system` when none does, and an agent session's names `agent`; each takes the partner its event names as the user it worked for. A row a `system` actor last changed names `old_system`. A row with no author names `old_system` too. The old columns that name a partner by slug, such as `deal.owner`, name that partner's user.

Every copy loads `schema/copy-attribution.sql` after `next.sql`, with the new schema on `search_path`. Its `copy_attribution(old_type, old_id, author_id, old_field)` returns `changed_by_user_id`, `changed_by_job` and `changed_for_user_id`. Pass `coalesce(updated_by, created_by)` as the author. Omit `old_field` for the whole row, or pass the field whose separate setter is being copied, such as `contact_state`. The latest event is ordered by `mutation_order`, not the date a caller supplied, and contributes only when its actor matches the author. `ingest_email` maps to `mail_capture`; the registered interactive runtime actors map to `agent`. Other automatic work stays `old_system` until a replacement is known. Only `agent` and `mail_capture` take the event's human sponsor. Missing sponsors stay unknown, and a human or system actor keeps its own mapping regardless of the event's cause. Drop this helper before dropping the old `public.actor` and `public.event` tables, which its SQL body depends on.

## Links

Each link is one row. No record holds a list or a column per role.

- **`party_role`**: what a person or company is to us. One row per role. A vendor's vendor role also holds its stage and relationship level, and a lead's lead role its stage and owner.
- **`party_email`** and **`party_phone`**: a person's or company's emails and phone numbers, one row each, with a label and whether it is the primary one.
- **`party_specialty`**: a person's specialties, one row each.
- **`party_company`**: a person at a company, with their title there and the dates they started and left. A person who moves keeps the old row, with its end date, and gets a new one.
- **`party_territory`**: who serves a territory, with the dates they started and stopped. A user serves as their person.
- **`deal_party`**: who is on a deal, in which role. The client, the listing agent and each vendor are rows here.
- **`deal_property`**: the properties a deal is considering.
- **`offer_document`**: the documents of each round.
- **`activity_about`**: each deal, person or company, or property an activity concerns.

## Rules the database enforces

Each rule has a test in `src/next-database.test.ts` that fails without it. The tests work as the engine's role (see "Who may change what"), so each refusal is a constraint, a trigger or the merge checking values, or a privilege the role lacks.

1. A link to a record that does not exist is refused, and so is deleting a record something still links to.
2. Every role on a person or a deal comes from the role list.
3. The same link is stored once.
4. A person or company is one of the two kinds.
5. A round's number is used once per deal, and a round answers an earlier round of the same deal.
6. A round comes from someone on the deal, in their role on that deal, about a property the deal is considering.
7. A round is never rewritten or removed, not even by emptying the table. Only its status changes, and a merge points it at the survivor. New terms are the next round, and `withdrawn` takes a round back.
8. At most one round per deal is accepted at a time.
9. Rent, NNN, term, TI, free rent, the escalator and days after delivery are never negative.
10. A round's status moves only out of `open`, or from `accepted` to `superseded`. Every other status is final. A round is superseded only when a later round of the same deal is accepted, checked when the change is saved.
11. Rent starts on a date or a number of days after delivery, never both.
12. A person-at-company link joins a person to a company, ends no earlier than it starts, and is stored once.
13. A deal's phase changes are never rewritten or removed, each phase comes from the list, and a move to dead says why.
14. An activity is an email, a call, a meeting or a note. Each `activity_about` row names exactly one deal, party or property, and is stored once.
15. An email's Message-ID is stored once and never has spaces around it, an email belongs to an email activity, and an attachment names an email. An email is about at least one record, checked when the change is saved, so an email about nothing is refused and so is removing, moving or emptying away its last link.
16. A next step is about exactly one deal, party or property.
17. A social account is on a known platform, its handle is never empty or only whitespace, and a handle is used once per platform, in any case. Its platform account id is never blank, is used once per platform, and never changes once someone has signed in as it.
18. A post is on its account's platform, in a format that platform offers, and is scheduled, publishing, published, failed or cancelled. Only a published post has the platform's post id and its publish time, and that id is stored once per account. A failed or cancelled post says why, and no other post has a reason.
19. A post is never removed, and a published, failed or cancelled post never changes. A retry is a new post.
20. A reading is of a published post, taken no earlier than it was published, of a metric its platform reports, and never negative. It names its source. A reading that could not be taken has a reason and no value, never a zero. A source or reason is never empty or only whitespace.
21. A reading is stored once and never rewritten or removed.
22. Each platform's reported metrics come from the known platforms and metrics, each once, with the time from which posts must have it, and only a schema change adds one.
23. A post starts scheduled, published or failed, moves from scheduled to publishing or cancelled, and from publishing to published or failed. Nothing else moves.
24. A post is scheduled, or claimed for publishing, only when its account's `engine_publishes_from` is at or before its time. None means never. The account's time cannot change while a claim is being saved, and only the owner sets it.
25. A sign-in is as its account's own platform account id, ends after it starts, and is never rewritten or removed.
26. Each platform's formats come from the known platforms and formats, each once, and only a schema change adds one.
27. A post's text versions run 1, 2, 3 with no gap. A later version is an edit by a user, written while the post is scheduled and before its review closes, an hour before its time by the database's clock. Text is never blank, rewritten or removed.
28. A post's media are documents in order, from 1 to 20. A text post has none, and only a photo set has more than one. Each medium is in its post's format, and its file is of the document's own type: an MP4 for a video, a PDF for a document, and a JPEG or PNG otherwise. A medium is never changed or removed.
29. A review is an edit, a cancel or no response, judged by the database's clock. An edit names a text version after the first, and a cancel is of a cancelled post; both name a user, as the one who made it or the one a job worked for, and come before review closes. No response is a job's for no one, comes at or after the close, only for a scheduled post with no other review. A review holds its post until it is saved, so an edit and the job writing no response take turns. Each version is reviewed once, a post is cancelled and gets no response at most once, and a review is never rewritten or removed.
30. A record or link keeps when it was stored.
31. The engine empties no table, removes no history, and changes only the columns that may change.
32. An email address is one address in lower case, with no name around it, and so is an email's sender. A person or company has each address once, labelled work or personal, and at most one primary.
33. A phone number is a plus and digits only (E.164), and a North American one is +1 and ten digits. An extension is digits only. A person or company has each number and extension once, labelled work, mobile or home, and at most one primary.
34. A change a person makes names the user who made it, and records them and the time itself. A user is a person, and only the owner adds one. A text edit, an edit's review, a cancel and a sign-in name a user.
35. A change a job makes names the job, and the user it worked for, if any. A row names a user or a job, never both and never neither, even when the owner loads it with the stamp turned off. A job comes from the list, and only the owner adds one. A statement that changes nothing keeps who last changed the row.
36. An NPI is ten digits ending in its check digit, and one person or company holds it.
37. A specialty is a person's, comes from the specialty list, and is stored once per person.
38. A person or company is marked do not contact once, with a reason that is never blank and never changes. Its optional until-date may change; outreach reads active_do_not_contact, which includes a stop through that date and an indefinite stop forever.
39. An outside id is for exactly one person, company or deal, is stored once per source, and the engine never rewrites or removes one. A merge moves it to the survivor. Its source is a lower-case name, and its value has no space around it.
40. A territory piece is exactly one of a whole state, a named market, or a distance of more than zero miles from a base point, and a territory holds each piece once.
41. A state is a two-digit and a county a five-digit Census FIPS code. A latitude is between -90 and 90 and a longitude between -180 and 180, and a property has both or neither.
42. A market's name is never blank and is used once, and a market holds each county once. A territory's name is never blank.
43. Someone serves a territory that exists, ends no earlier than they started, and is linked once per start date.
44. A merge joins two different people or two different companies, neither merged away. It never merges a user away, and never two records that each hold an NPI.
45. A merge moves everything that points at the duplicate, in every table, to the survivor, and removes the duplicate. Where both hold the same link, the survivor's row stays, and so do its primary email and primary phone. Do not contact keeps the longest restriction and its reason. A second merge onto the same records waits for the first.
46. Only a merge leaves a merged-into pointer, and it names a live record, so merges never chain or loop. Nothing new points at a merged-away record, and its id is never used again. Only the engine and the owner run a merge.
47. A vendor's category is a role whose `category_of` is vendor, and it stays one. Only a vendor holds a vendor category, checked when the change is saved.
48. A stage comes from its own role's stage list, and is stored once per role.
49. A relationship level is a vendor role's, one of the four levels, and only a schema change adds or renames a level.
50. An introduction is with a vendor, made by the vendor or the team, of a person or company other than the vendor, and about a deal that exists. One the team made names the user who made it, and one the vendor made names none. Its note is never blank, and who it joins and who made it never change. A vendor keeps its vendor role while it has introductions.
51. A disposition and a target are a vendor role's. A disposition is parked or avoid, and none is active. A parked or avoided vendor has a reason that is never blank, and an active one has none. A merge keeps the stricter disposition, avoid over parked over none, with its reason. An avoided vendor cannot be a target, and a merge clears its target.
52. Every insert, update and delete of a stamped row leaves one change row: the record's key, the fields it changed from what to what, and who made it and when. A statement that changes nothing leaves none.
53. The engine never adds, rewrites or removes a change, and a removal names who made it. A change is an insert, an update, a delete or an owner-requested erase.
54. A change a merge makes names the merge, and only a merge saved in the same transaction is named.
55. A deal's kind comes from the kind list and its reason from the reason list. Either may be unknown.
56. A deal has exactly one deal owner, a user.
57. A deal's market comes from the market list, and its closed value is more than zero.
58. Lease versions are consecutive on a deal, have a source document and ordered dates, and never change or disappear. A supplied offer was accepted when recorded and belongs to the same deal and property. Typed amounts are nonnegative, term is positive and rent starts on a date or after delivery, never both.
59. Every lease option is numbered once on its version, is renewal, expansion or early termination, and has an exact notice deadline and nonblank terms. An option notice is no later than the lease ends. Options never change or disappear; sourced options may be added to any version as they are extracted.
60. A critical date starts proposed, with a known kind and nonblank source; its source round, lease or option exists and belongs to its deal. Repeated generated proposals are stored once.
61. Only a direct user confirms or resolves a critical date. The database records who and when, retains confirmation through resolution, and refuses all other transitions, rewrites and removals. Resolution needs a nonblank reason.
62. A lead has a stage. Only a lead has an owner, and the owner is a user.
63. A lead or client says how they were found, from the list. A new lead or client is checked when the change is saved.
64. Someone on a deal as its client holds the client role, checked when the change is saved, so the role cannot be removed while they are.
65. A client profile names its client role, has only roster, cold, engaged or paused as manual status, and takes its type from the client type list. Active deal and past client come from deals.
66. A brand membership joins two different companies, its location has a client profile, and its dates never overlap another membership of that location.
67. A national account is a company holding that role. Its dated owners are people, and their dates never overlap on one account. Membership and ownership end strictly after they start, with the end excluded.
68. Client and account profiles and their dated links keep their parties; users may correct dates and remove mistakes. A merge carries a lone profile and refuses two client profiles or two account profiles rather than discarding their histories.
69. A parked deal says why: the client paused, the prospect was never active, or another reason. Only a parked deal has a note, and a note is never blank.
70. A deal needs attention or does not; it is never unknown. Only a user, or a job working for one, parks, revives or flags a deal.
71. Lead stage evidence names a lead and two different lead stages. Non-archive moves name an activity about that lead and nonblank evidence. Repeated proposals for the same activity and move are refused. An unattended job applies only strong evidence along the funnel; weak evidence and every archive wait for a direct user, and archiving has a nonblank reason. Applying a stale proposal is refused. Applied evidence is final and never rewritten or removed.

72. A lead's lane comes from its list. A lease estimate has both date and nonblank source, and confidence only with an estimate. Lane, estimate, confidence and segment belong only to the lead role. How-found detail is nonblank and has how found.
73. A deal's commission is recorded once. Its expected amount and gross are more than zero, and an override is a share between none and all.
74. A payment is part of a deal's commission, more than zero, and invoiced no later than it is due or received. Payments never add up to more than the gross, and none comes before the gross, checked when the change is saved.
75. Each share to someone other than the users names a person or company, is a referral, brokerage or other share, and is more than zero. The shares never add up to more than the whole, checked when the change is saved.
76. A ladder tier is a user's, from a count of one or more, stored once per count, and names a partner who is another user, the same one on every tier. The closing user's part is between half and all. A ladder starts at the first closed deal and never steps up, checked when the change is saved.

Two people adding different links to one deal at the same time both keep theirs, because each link is its own row. A test proves it with two open sessions.

## Who may change what

`schema/next.sql` defines `engine`, the role the engine will use on this database. A login takes it with `grant engine to <login>`. The engine connects with `role=engine` set, or as a login created in SQL. A role made in the Neon console belongs to `neon_superuser`, and its own rights would bypass these grants. Loading the schema refuses an existing `engine` role that is a member of any role, is a superuser, bypasses row security, or can create roles or databases or replicate.

The role reads rows in every table, adds rows in every table except `app_user`, `job`, `merged_party`, `change`, `platform_metric`, `platform_format` and `relationship_level`, and empties none. A social account it adds has no `engine_publishes_from`, so removing an account and adding it back cannot set one. A text version and a review it adds take the stamp's time, the clock's, which no statement sets. It removes rows only outside history, and changes only these columns:

- a role's, a stage's, a phase's, a deal kind's, a deal reason's, a specialty's or a how-found's label;
- a vendor role's stage, relationship level, disposition, reason and target, a lead role's stage and owner, and an introduction's date, deal and note;
- a party's, market's, territory's, deal's, document's or design template's name, a party's NPI and how found, and a property's address, county and point;
- a deal's kind, reason, deal owner, market, closed value, parking reason and note, and whether it needs attention;
- a person-at-company link's title and dates, and a territory link's dates;
- an email's or phone number's label and whether it is primary;
- an activity's time, sender and summary;
- a next step's text, owner, due date and done time;
- a round's status, and a critical date's status and resolution reason;
- a do-not-contact row's until-date;
- a social account's handle and platform account id, and an idea's angle, hook and pillar;
- a post's status, reason, platform post id and publish time, until it is published, failed or cancelled;
- a commission's expected amount, gross and override, a payment's amount and dates, a share's size, and a ladder tier's closing part.

History is `critical_date`, `lease`, `lease_option`, `deal_phase_change`, `offer`, `offer_document`, `post` and its `post_text`, `post_media` and `post_review`, `measurement`, `social_sign_in`, `outside_id` and `change`. Ids, `created_at`, and the records a link or an about row joins never change; a different link is a removed row and a new one. Who an activity came from and who owns a next step can be corrected. PostgreSQL refuses anything else before it touches a row, so a save runs no trigger just to be told no. Besides the stamp that writes who changed a row and the history that records it, the triggers left check values: a deal parked, revived or flagged by a user, a round's status moves, a later acceptance superseding a round, a lease's round accepted when recorded, a critical date's user confirmation and resolution, an option notice before lease expiration, an email about a record, a post's status moves, a post that is final, the engine's start time for an account, an edit or review inside its window, a reading of a published post, and a merged-away id used again.

A merge is the one path that rewrites history: `merge_party` runs with the owner's rights and points rounds and outside ids at the survivor. Each row it moves is stamped with whoever ran it, so a moved row's stamp no longer names who first stored it. Its change history still does, and names the merge.

The owner's own login can still change anything. That path is not the engine's concern.

## Emails and phone numbers

A person or company can have several emails and phone numbers. Each is a row in `party_email` or `party_phone` with a label, and one of each may be primary. A changed address or number is a removed row and a new one.

Each is stored in one form, so a repeated address or number is caught (decision 32). The database checks the form and does not convert; whoever writes a row converts first. An email address is lower case ASCII, with no display name. A phone number is E.164, such as `+12175550100`, and an extension such as "x12" is its own column. The same address or number can be on two parties, such as a shared front desk. Two parties that turn out to be one person are merged (see "Merging duplicates").

An email's `sender` is stored in the same form, so the agent finds who sent it by matching `sender` to `party_email.address`, and sets the activity's `from_party_id`. The rows are keyed address first, so that match is a lookup.

Today's `party` row holds one free-text `email`, `phone` and `cell` on each person and company, as typed. Moving them across:

- `phone`, the office line, becomes a work number, primary. `cell` becomes a mobile number, primary when there is no `phone`.
- A ten-digit number, with or without a leading 1 and in any punctuation, becomes +1 and its ten digits. A trailing extension moves to `extension`.
- `email` sometimes holds several addresses, or a name with the address in angle brackets. Each address becomes its own work row, lower case and trimmed, and the first is primary.
- The same number or address twice becomes one row. `cell` is primary when no `phone` row is stored.
- A value that fits neither form is not stored. The move lists it for a partner to fix.

## Do not contact, NPIs and outside ids

Do not contact is a fact about the person or company, whatever roles they hold, so a lead, a client and a vendor contact are all covered by one row. The owner: "the only time we would make someone do not contact it would be for any reason." Its row is keyed by the party alone, so any outreach finds it with the party's id. It carries the reason, and its stamp says which user or job set it and when. The reason never changes. Changing its until-date restamps it, and history keeps the earlier stamp; lifting it removes the row.

An NPI is checked for shape: ten digits, the last a Luhn check digit over the prefix 80840 and the first nine. The first digit is not checked, so tests use made-up numbers starting with 9, which no NPI issued yet does. NPPES issues each number once, to a person or an organization, so the number is unique across both. A doctor's specialties are rows in `party_specialty`; a company has none.

Old reference ids, such as Salesforce ids and roster numbers, are kept in `outside_id` only to trace where a record came from. Nobody types or searches for them, so they are not party or deal columns. A source and value are stored once, so a repeated import finds the record it already made. Only a merge changes a row, so its stamp names the job or user that imported it, or the one that last merged it, and when.

## Copying today's people and companies

`schema/copy-parties.sql` copies today's parties into the new database, with their emails, phone numbers, NPIs, do not contact, specialties and outside ids, and each person's company and title there. The owner runs it in one transaction with `search_path` set to the new schema. It only reads today's tables, and ends with its `not_copied` list: each old record or value it left behind, as typed, and why, for a partner to fix in today's system before the real run.

- Each record keeps its id and when it was stored, and `org` becomes `company`. Each partner, a `human` actor, becomes a person and a user under the actor's id.
- `outside_id` maps each old id, under the source `old_system`, to the record it became. A merged-away old record maps to the record its merges end in. A merge in the new database moves the map, so later copies of deals, vendors and territories find each record through it. A second run copies only old records the map does not hold.
- Today's merge left a duplicate's values on it, so they come across to its survivor, as `merge_party` would move them: the survivor's own first, then its duplicates' by when they were stored. A record merged into one an earlier run copied is listed if it holds values, since only its outside ids still reach its survivor.
- A deleted record is not copied, nor one merged into it.
- Emails and phone numbers follow "Emails and phone numbers" above. The first value stored is primary. An email holding an `@` that no address took is listed whole.
- An NPI stays with the record that held it first: one already in the new database, or else the first stored. A second holder is copied without it and listed, since it may be the same person or company. So is a duplicate's NPI when its survivor holds another, and an NPI with a wrong check digit.
- Do not contact moves with its reason, trimmed, and whoever set it and when. One without a reason is listed. `paused` moves with its reason and end date; one missing either is listed.
- `nurture` sets an existing lead role's stage to nurture, through the old-id map, including merged-away ids. It applies only when the mark is newer than the lead role, keeps the latest nurture setter's stamp and leaves the lead owner and other roles alone. A mark without a copied record or lead role is listed with a reason and never creates a lead. Each run revisits nurture marks so roles copied later can receive them. It updates only stages other than nurture, so an unchanged rerun adds no change history. A lead stage as recent as or newer than the mark stays unchanged, and the mark is listed for a partner.
- Today's free-text specialty is split at commas and semicolons. Spellings that differ only in case, spaces or punctuation are one specialty on the list, with a slug of lower case letters, digits and `_` and the spelling first typed as its label. One already on the list keeps its label. A company's specialty, and one with no ASCII letter or digit, is listed.
- Today's `record_source` rows for a party, vendor, lead or client become outside ids of the record it became, and each party's `ref` one under `old_system_ref`. A source is lower-cased, with `_` for each run of anything but letters and digits, so `vendors.xlsx` becomes `vendors_xlsx`. A `dup_candidate` row only hints at a duplicate, so it is listed. So is a row for another kind of record, a row whose record is not copied, a source that folds to `old_system` or `old_system_ref`, which the copy keeps for itself, and an id another record already holds. Rows for deals, activity, events and loop items are left to the copies of those records.
- A person's company and title become a `party_company` row, with no dates, at the record the company became. A title comes from the survivor first, then its duplicates, and a title beats none. A company's own `org_id` is the national account it belongs to, which has no place until national accounts are designed, so it is listed. So are a company that is not copied or is a person, with the title held there, a title without a company, and a duplicate's other title at the same company.
- `city`, `state`, `county`, `contact_state_cadence` and `notes_path` have no place yet, so each value is listed (#271).

## Clients, brands and national accounts

A `client` row extends its party's client role with a manual status and a `client_type` from the short list. The initial types are independent, group practice, DSO, franchise and regional system. Labels may change, like roles. Only roster, cold, engaged and paused are stored. `client_status` reports active_deal when any client deal's latest phase is neither closed nor dead, including a deal with no phase yet. Otherwise any closed phase in its history makes it past_client, and otherwise the manual status applies. An open deal wins over past work. A dead deal alone does not make a past client.

A brand is a company. `client_brand` joins a client location company to a different brand company, with dates. Its dates include started_on and exclude ended_on, and an absent end means still a member. Memberships never overlap, even across brands. Ending one and starting the next on the same day preserves which brand held the location on each date. A franchisee has its own client row and franchise type; its deals name it, never its brand.

A `national_account` is a company with that role. It need not itself be a client. `national_account_owner` names a person, including an outside agent who refers work, with dates under the same non-overlap rule. It does not name an app user or decide a deal's owner. The engine can correct membership and ownership dates and remove mistaken links; change history keeps what was corrected. Changing the parties removes the mistaken link and adds the right one. All five tables are stamped and their changes recorded. A merge moves a lone profile and its dated links; two client profiles or two account profiles are refused for a user to settle first, as are overlapping histories or a location becoming its own brand.

For #273, national on a date means a `client_brand` membership covering that date whose `brand_id` joins `national_account.party_id`. A deal uses its location client and its own date for this join, so a later rebrand does not move old work. The current directory uses current_date instead. There is no stored national flag here.

Moving today's rows across:

- Each client becomes its party's client role and client row. Roster, cold, engaged and paused map directly. Active deal and past client are recomputed; those old labels supply no manual status, so start those records at roster.
- The five client types map to the short list. National account becomes the national_account role and row on its company, not a sixth type. Unknown types wait for correction. Vertical and subtype do not move as free text.
- A company location's `party.org_id` becomes its brand membership. A person's org_id remains party_company. Existing national_account_owner rows map their human actor to its person; an outside owner's person is used directly. The old system lacks membership start dates and complete owner history, so a user must supply the first known dates before copying these links. Never invent an earlier history.
- Client owner and acquisition source belong to the lead and attribution slice, not account ownership. ETL status and agreements are excluded by the owner's B9 answer. No representation agreement table is added.

## Offer rounds

Every LOI, counter and response is a new `offer` row. It holds its round number, the round it answers, who sent it and in what role, when, and its status: `open`, `countered`, `accepted`, `rejected`, `withdrawn` or `superseded`. The standard terms are typed columns, so the app can show what changed from one round to the next: rent and estimated NNN per square foot per year, term in months, TI per square foot, free rent months, yearly escalation percent, and when rent starts, as a date or as a number of days after delivery. Each later term is one more column. An optional `expires_on` records an LOI's stated expiry; only an open round proposes that deadline.

`everything_about_deal` returns a deal's phase changes in order, its properties, its people with their roles, its rounds in order with their documents, its activity in time order with each email and its attachments, and its next steps by due date, in one read. The property reaches the deal through `deal_property`, and the client and the listing agent through `deal_party`.

## Owner decision: unusual one-off terms

Some LOIs carry a term no other deal has, such as an exclusive-use clause. There are two ways to keep it:

- **A plain text field on each round.** This is built and recommended. It keeps one place, is easy to read, and the document holds the exact wording.
- **A row per extra term**, each with a name and a value. Each term could then be compared round to round, at the cost of another table and a name for every term.

Unusual terms are rare and are read by people, not computed, so the text field is enough.

## When a deal falls apart

A round's status records what happened to that round, and the deal's phase records where the deal stands. An accepted round stays accepted when the deal later dies. The deal moves to the dead phase, with a date and a reason, and nothing is deleted. If talks restart, the deal moves to a live phase again and the new rounds answer the last one. When a new round is accepted, the earlier accepted round becomes `superseded` in the same save, so a deal has one current accepted round. An accepted round is never superseded on its own. A mistaken status is fixed by a new round, as a mistaken term is.

## Activity, emails and next steps

- **`activity`** records something that happened. **`activity_about`** links it to each deal, person or company, or property it concerns, one row each. One email about a deal, its client and its lender shows on all three timelines.
- **`email`** holds the message's own Message-ID header (Outlook's `internetMessageId`), never an id one mailbox gives it, so mail both users received is stored once. The id is unique, keeps its case, and is refused with spaces around it. The row also holds the sender, the subject and the new text only, with quoted history removed. The date is the activity's time. The agent stores only an email it ties to a record. Mail that matches nothing stays in the mailbox and is not copied, and the database refuses an email that is about no record. The original mailbox stays the full record.
- **Attachments** go to R2. Each becomes a `document` that names the email it arrived with.
- **`next_step`** is about exactly one deal, person or company, or property. Its owner is a party.

A row that may point at one of several kinds of record has one checked key per kind and a check that exactly one is set. It never holds a type word and an id the database cannot check (decision 21). Activity and next steps are not history: a note can be corrected, and a step is marked done.

Size, as reasoning: a stored email is a few kilobytes of plain text, without attachments or quoted history, and only mail about a record is kept. So the table grows with deal work, not with mailbox traffic. Files grow in R2.

## Worked example: an LOI response by email

The partners toured 100 Example Way with their client and sent an LOI. The listing agent emails back with a counter.

1. The client and the listing agent are each a `party`, with `party_role` rows for client and listing agent.
2. The property is a `property`, linked to the deal by `deal_property`.
3. On the deal, `deal_party` holds the client as client and the agent as listing agent.
4. Our LOI is round 1, sent by the client.
5. The agent's email becomes an `activity` from the agent, with its `email` row and `activity_about` rows for the deal and the agent.
6. The attached PDF goes to R2 and becomes a `document` that names the email.
7. The counter is round 2. It comes from the agent as listing agent, answers round 1, carries its own terms, and links the PDF in `offer_document`. Round 1 becomes countered.
8. Our response is round 3. The agent's acceptance marks it accepted.
9. A `next_step` on the deal says to start the lease draft.

The tests run rounds 1 to 3, the acceptance, the email with its attachment, a call and the next steps, and read them back in order.

## Leases and options

A signed lease is a `lease` row with its deal, property, exact execution and expiration dates and source `document`. Its typed terms are independent of the LOI, because a signed agreement can differ. Rent and NNN are per square foot per year, TI per square foot, and escalation a yearly percent. `rent_starts_on` or `rent_days_after_delivery` keeps rent commencement separate from the lease's start.

An optional `offer_id` names a round accepted when the lease is recorded, on that same deal and property. Old leases with no surviving rounds need no invented LOI. A later acceptance can supersede that round without changing the signed lease.

Each amendment or correction is the next consecutive version on the deal. Versions and their `lease_option` rows are history, never rewritten or removed by the engine. `current_lease` selects the latest version per deal, so lease endings can be queried by `expiration_on`. Options are numbered within that version, each with its kind, exact `notice_on` and terms. A new version includes every option that still applies. Sourced options may be added to any version when they are extracted later; an existing option row never changes. A notice may predate an amendment that retains it, but cannot follow the lease expiration.

Moving today's rows across, order each deal's leases by its supersedes chain and preserve every version. Rows missing execution or expiration dates or a source document are listed for a partner to fix, never silently dropped or completed by inference. Exact end dates stay exact, never calculated from term months. Store the executed lease, amendment or abstract evidence as a document. Unknown typed terms stay null. Convert a legacy rent quote only when its unit is known; otherwise keep the wording in `other_terms`. Options in `options_note` need their individual terms and sourced deadlines before becoming option rows; keep unparsed wording in `other_terms`. The old radar's current lease ending becomes `current_lease.expiration_on`; the 24-month radar and 18-month renewal windows remain read filters. Leases without brokerage work and the link from a new renewal deal to the lease it renews follow in #280. Critical date proposals follow in #279.

## Critical dates

A `critical_date` starts proposed, with a deal, kind, due date and nonblank source. It can name its source round, lease, lease option or document; a round or lease must belong to that deal. Kinds are LOI expiry, option notice, rent start, lease end, due diligence or other. The source text describes manually added dates too.

`propose_critical_dates(deal_id)` derives dates from current lease versions and their options, and expiries on open rounds. Repeating it adds nothing twice. It uses exact dates only; days after delivery need an actual delivery date before a rent-start proposal can be made. New amendments produce new proposals; old proposals and confirmed dates remain for a user to drop when appropriate.

A direct user confirms a proposal to open, or drops it with a reason. Only a direct user resolves an open date as done, dropped or passed, with a reason. The database writes confirmation and resolution users and times itself. Jobs, including agents working for a user, can propose but cannot decide. Confirmation stays when a different user later resolves the date. Dates, sources and decisions cannot be rewritten or removed; a correction is a new proposal and a reasoned drop.

Today's `critical_date` rows keep their kinds, dates, sources and notes. `option_window` maps to `option_notice`, an unlisted kind to `other` with its original wording in the note. A date directly added by a user takes its confirmation from `created_by` and `created_at`; dates proposed by automation still need user confirmation. `cleared` maps to `done`. Resolved rows take their user, time and reason from the resolution event log; a legacy resolution without that evidence is listed for a partner to fix. The owner's load preserves known users and times with the transition and stamp triggers disabled, and lists missing evidence or decisions for a partner to fix rather than inventing confirmation. Today shows confirmed open dates; proposals stay in the confirmation queue. These reads follow in later slices.

## Marketing

The owner's automation keeps posting as it does today. These tables record what went out and how each post did, so each week's posts can learn from earlier ones.

- **`social_account`**: a presence on X, LinkedIn, Facebook or Instagram, by its handle, owned by a party. "Account" alone means a national account (`docs/glossary.md`). It holds the platform's own id for it, learned at sign-in, and `engine_publishes_from`, the time from which the engine publishes its posts.
- **`social_sign_in`**: one row each time a user signs in to a platform for an account: who, as which platform account, when, when it expires, and the scopes granted. The token itself lives in Workers KV, never in the database. A Facebook Page's sign-in does not expire, so it has no expiry.
- **`platform_format`**: the formats each platform takes, one row each: text, photo, photo set (several photos or a carousel), document (a PDF carousel, LinkedIn only) and video (a Reel on Instagram). Instagram takes no text-only post, and Facebook no photo set. X keeps its rows for the posts already sent there. Only a schema change adds one.
- **`idea`**: what a post says, as its angle, hook and pillar. One idea can run on several accounts.
- **`design_template`**: a reusable look that a post's image is made from.
- **`platform_metric`**: the metrics each platform reports, one row each. LinkedIn and X do not report saves, for example. The rows are a guess, to be confirmed against each platform's API. Each row says from when posts must have the metric. The first rows hold from the start, and a row added later holds from when it is added, so older posts, which have no reading of it, stay in the day-7 comparison. Only a schema change adds one.
- **`post`**: one post on one account, with its format, idea, design template, when it was scheduled, and its status. A post without an idea or a template still counts for its account.
- **`post_text`**: a post's words, one row per version. The weekly batch writes version 1 through intake. A user's edit is the next version, stamped with its user and time, so nothing is overwritten. The latest version is the one posted.
- **`post_media`**: a post's files in order, each a `document` in R2.
- **`post_review`**: what happened in review: a user's edit, naming its text version, a user's cancel, or no response, written when review closes on a post nobody touched.
- **`measurement`**: one reading of one metric of a post: when it was taken, its source and its value. A reading of a metric the post's platform does not report is refused, and so is a reading before the post is published. A reading that could not be taken is stored as not measured, with its reason, so a gap never reads as zero.

A post goes out unless a user cancels it. `scheduled` means the engine will publish it. At its time the publisher claims it by moving it to `publishing` with `where status = 'scheduled'`, so only one run can send it. It then becomes `published`, with the platform's id and time, or `failed`, with the platform's error as its reason. A post stuck in `publishing` is resolved by a user to one or the other, never sent again, and the post names that user. A cancelled post keeps its reason. Users edit or cancel until review closes, an hour before the post's time, and each edit or cancel is a review row. A post another publisher sent, such as Blotato, is stored as `published` or `failed` from the start.

One publisher holds each account at each minute. The database refuses a scheduled post, or a claim, before its account's `engine_publishes_from`, and an account without one never gets an engine post. The weekly batch sends earlier posts elsewhere. Moving the time later stops new claims at once, and the engine cancels the posts it no longer holds. The engine's role cannot set or change the time, even on an account it adds; the owner sets it at each cut-over.

Ratios are calculated when read, never stored. Engagement is the sum of the reactions, comments, shares and saves that the post's platform reported when it was published, and engagement per view divides it by views. After a metric is added, newer posts sum more metrics than older ones, so best and worst across that date lean toward newer posts.

`posts_at_day_7(as_of)` compares posts at the same age, because a post's numbers keep growing for days. Each post is judged by its latest reading of each metric at or before 168 hours after it was published. It returns, per account, how many posts it compared and the best and worst by engagement per view.

A post is left out while it is younger than 7 days, when it has no reading by day 7 of views or of an engagement metric its platform reports, or one whose latest reading by day 7 was not measured, or when it had no views.

Best and worst stay within one account, so they compare like with like. Averages per idea and design template come next (#206). They can mix platforms that count engagement differently, so each will show how many of its posts are on each platform.

Each ranked post carries `reading_age_hours`, the age of the oldest reading it was judged on. A post read only on day 3 shows 72, so the weekly loop and the Marketing screen can see it was judged early.

Pillars and hooks are text for now. They become lists, like roles and phases, with the rotation rules.

## Deals

A deal records what kind of transaction it is and why the client is taking space, each from its own short list. The owner ruled on #196 that today's one deal type is two facts, because a start-up lease was filed as one or the other (2026-11-16). The kinds are lease, purchase, sale-leaseback and build-to-suit. The reasons are start-up, relocation, expansion, renewal and additional office. Either may be unknown, as a deal's kind often is before a site is found.

Every deal has exactly one deal owner, a user, in `owner_user_id`. A second user can still be on the deal in another role. A new deal owner is an update of that column, so change history keeps who held the deal before, who moved it and when, with no dated table of its own. Who held a deal on a given day is the latest change to `owner_user_id` at or before it.

A deal names its market from the `market` list, which can be set when the deal opens, before any property is chosen, and stays empty until known. A closed deal records its value, such as the total lease value or the purchase price, in `closed_value`, which is empty until known and never zero. Nothing requires it at the move to closed, because the mail job closes a deal when its invoice arrives and the invoice does not carry it, so the value is left for a user to fill in.

A parked deal is not active work for now, and says why in `parking_reason`: the client paused, the prospect was never active, or another reason, with an optional note. No reason means the deal is active, as no disposition means a vendor is. Parking is not a phase and never changes one, so reviving a deal, which clears its reason and note, leaves it in the phase it was in. Who parked a deal and when is the latest change to its `parking_reason` in change history, so the deal holds no date or user of its own for it, and the same history keeps every earlier parking and revival.

`needs_attention` is a flag a user sets on a deal and clears, never worked out from anything else. Change history keeps who set it and when. Parking, reviving and flagging are each a user's act, or an agent's working for one, so a job working for no one, such as the publisher, cannot do them; it can still change the deal's other columns. A copy of today's parked deals turns that check off, as it does the stamp, because its history names who parked each one.

National is never stored. A deal is national exactly when its client is a location of a national account. National accounts and the brand behind each location come with #275, and with them the read that answers it. Until then nothing answers it, and since nothing stores it, no flag can disagree with the client, as today's lane sometimes does.

Moving today's rows across:

- `deal_type` splits in two. `lease`, `purchase`, `sale_leaseback` and `build_to_suit` become the kind, with no reason. `relocation`, `expansion`, `renewal` and `additional_office` become the reason of the same slug, and `startup` the reason `start_up`, each with no kind until a user sets it. `other` sets neither, and the deal is listed with its imported type for a user to file.
- `deal.owner`, a partner's slug, becomes that partner's user as the deal owner. A closed or lost deal with none takes its open `deal_participant` row with role `lead`. A deal with neither is listed. Earlier deal owners, from the closed `lead` rows, come across later into change history, dated when each changed, with the old `event` rows.
- `deal.city` becomes the market whose name matches it, and a national deal's `deal_market_assignment.market` the same way. One that matches no market is listed for a user to add the market or choose one.
- `won_value` becomes `closed_value`. `sf_commission_placeholder` is not copied (see "Commissions").
- `lane` is not copied. A deal whose old lane disagrees with its client's national account is listed once #275 lands.
- A `parked` deal's `parking_reason` comes across as it is, and its `parking_note` trimmed, a blank one as none. An `active` deal has no reason. `parked_at` and `parked_by` come across into change history with the old `event` rows, as earlier deal owners do, dated when the deal was parked and naming who parked it.
- `attention` becomes `needs_attention`.

## Markets and territories

A territory is the area someone serves. A user's territory, a vendor's market and a lead's area are one idea, so one `territory` table serves all three, and `party_territory` says who serves which, dated. A vendor that leaves a market keeps the old row, with its end date.

A territory is a set of pieces, because its shape varies. Each `territory_piece` is exactly one of:

- **a whole state**, by its two-digit Census FIPS code;
- **a named market**, a `market` row;
- **a distance from a base**, a latitude and longitude and how many miles the team will travel from it.

A named market covers whole counties, by their five-digit FIPS codes, in `market_county`. Counties are what metro areas are drawn from, so a market keeps the boundary the partners mean, and a property's county comes back with its point when its address is geocoded, such as by the Census geocoder. ZIP prefixes cross state and metro lines. A point and radius is already the distance piece. A property's state is the first two digits of its county.

`property_territory` lists each territory each property falls in. It has one branch per piece kind: the state of the property's county, a market holding its county, or a base within the piece's miles of its point. `miles_between` measures along the earth's surface. A property with no county or point falls in no territory until it is geocoded. Who serves a property is that list joined to `party_territory`.

The distance is plain SQL. PostGIS is offered on the production Neon project, but the check's PostgreSQL has no PostGIS, and changing the check is the owner's. `earthdistance` is in both, but as an extension it belongs to the whole database, not to the namespace this schema loads into. A sphere is close enough for "how far we will travel": the formula is the haversine, on a 3,958.8-mile radius.

Today's system keeps a vendor's markets as a list of named markets with a boundary written as text, a vendor's membership in each, and a free-text territory on the vendor. Moving them across, each old market becomes a `market` once its counties are listed, each membership a `party_territory` row on a territory holding that market, and each text territory a territory for a partner to draw.

Rents and expenses read from LOIs and leases build the market database. It needs no table of its own. A round already holds its rent, NNN, TI and free rent, and names its property, so a market's rents are the rounds whose property falls in it, read with `property_territory` or `market_county`. A lease's terms join the same way when leases come. A figure read from a document outside any deal, such as a broker's survey, is a following slice, with its source document and date.

## Vendors

A vendor is a person or company holding the `vendor` role. The owner ruled on #257 that a vendor's category, such as lender or contractor, is a role (2026-11-15). Each category is a role whose `category_of` is vendor, and a vendor holds a `party_role` row for each one. On a deal, a vendor is a `deal_party` row in the role it played, such as lender, so the deal shows it under that role and its track record reads the same rows. A vendor nobody has categorized holds only the vendor role, which says so plainly, where a catch-all category would hide it. A rare category is a new role.

A vendor's stage and relationship level are on its vendor role, because they describe the team's relationship with the vendor, not one of its categories. A stage comes from its role's own list in `stage`, so leads can take their own stages on the same column later. The four levels, as the owner defined them for today's system:

| Level | Label       | Meaning                                                                      |
| ----- | ----------- | ---------------------------------------------------------------------------- |
| 0     | Prospective | Worth knowing. No two-way contact yet.                                       |
| 1     | Building    | Two-way contact: they replied, or we met. Reaching out alone does not count. |
| 2     | Established | Value has moved in either direction: an introduction, a referral or a deal.  |
| 3     | Core        | Value has moved both ways, more than once.                                   |

No level means not yet judged, a different fact from 0.

A vendor's disposition is the team's ruling on it, and its target flag says the team wants to meet it. Both sit on the vendor role next to its stage and level (owner, #258). A disposition is parked, deliberately dormant and on drip only, or avoid, ruled out as a partner. No disposition is active, in the network. A ruling always carries its reason, so a vendor never leaves play without one. An avoided vendor cannot be a target. Disposition and target are not stages: today's stage list once held them, and the old system's migration 0047 split them out because a stage mixed how well the team knows a vendor, a ruling and an intent.

An introduction is one `introduction` row, made either way: the vendor introducing someone to the team, such as a new client, or the team introducing someone to the vendor. It names the vendor, who made it, whom it introduced, when, a note, and the deal it led to, which can be set when one comes of it. One the team made names the user who made it.

`vendor_track_record` gives each vendor's record from deal history only. Nothing stores a rating (owner, #257). It counts the deals the vendor worked in any vendor role, how many of them closed and how many died, by each deal's latest phase, and the deals that its introductions to the team, and the team's to it, led to. A deal counts once, however many roles or introductions tie it to the vendor.

Moving today's rows across:

- Each `vendor` becomes the vendor role on its party, with its `relationship_level`, `disposition` and `is_target` as they are, and `active` becomes no disposition. These columns hold 0047's split and every change since, so they win over an old stage. Today's rows have no reason, so a parked or avoided vendor waits to move until a partner gives one. It never moves as active, which would put it back in play.
- Each `vendor_category` row becomes a role whose `category_of` is vendor, and a vendor's `category_slug` its role. The deal roles of `deal_vendor_assignment`, such as title and inspector, join the same list, and `gc` becomes contractor. Each assignment becomes a `deal_party` row, and so does each worked deal in a vendor's `deal_evidence`.
- Each `vendor_stage` row becomes a vendor stage, and a vendor's `stage` the stage on its vendor role, except the nine original stages. The old system's migration 0047 split those into level, disposition and target, which already hold what they meant, so none of them, such as avoid or target, comes back as a stage (owner, #258).
- Each `party_link` of kind `introduced` or `referred`, or of the older `intro`, `intro_received` or `referral`, becomes an introduction. One whose `via_party` is the vendor was made by the vendor, and one made through a user by the team, naming that user. One whose `via_party` is empty, or is neither the vendor nor a user, waits for a partner to say who made it. Each `party_link_deal` whose `referred_by` is a vendor becomes an introduction made by that vendor, with its deal. A `can_introduce` or `intro_requested` link has not happened, so it is not an introduction.
- `trust_override`, a hand-set rating, does not move.

## Leads and clients

A lead is a person or company holding the `lead` role, and a client one holding the `client` role, so a lead that becomes a client is the same record with one more role. The owner ruled on #196 (walkthrough 4, 2026-11-16).

- **Becoming a client.** Someone is a client as soon as a deal is opened for them, signed or not. The client on a deal is a `deal_party` row, and the database refuses one whose party does not hold the client role. The engine adds the role with the deal, in one save, and the role's `created_at` is when they became a client. The lead role stays, with its stage, owner and history, so the Leads screen can leave out a lead who has become a client.
- **Owner.** A lead's owner is the user who works it. None means nobody works it yet, and any user can take it. Territory is shared, so a lead's area never picks its owner. Change history keeps who owned it before.
- **Stage.** A lead's stage comes from the lead stages in `stage`: New, Qualified, Outreach Active, Engaged, Nurture, Opportunity and Archived. Nurture replaces named drip campaigns. Do not contact is the party's `do_not_contact` row, and deal outcomes are deal phases, not lead stages.
- **How found.** Each lead and client says how they were found, from the `how_found` list: referral, vendor, marketing post, public records and cold outreach to start. It is a fact about the person or company, so it holds in every role, and a lead that becomes a client copies nothing. A list can be counted for lead attribution, where free text cannot.
- **Stage evidence.** `lead_stage_move` holds evidence-backed proposals and applied moves, with the activity, evidence reference and strength. The activity must remain linked to that party through `activity_about`, checked at commit. A proposed row leaves the stage alone. Applying it holds the lead and changes its stage only if it still matches `from_stage`. Unattended jobs apply strong evidence only along New → Qualified → Outreach Active → Engaged → Nurture or Opportunity. Weak evidence, including an agent acting for a user, waits for a direct user to apply it. Every archive needs a direct user and a nonblank reason. Ordinary user stage edits, including corrections by an agent working for a user, use change history alone. Archiving may omit activity and evidence reference, so a user never invents contact to give a reason. Matching proposals collapse on merge, with the removed row retained in change history. Evidence rows use the same stamp and change history, so proposal and approval keep both actors without duplicate who-and-when fields. Applied evidence stays applied; undo is a new move or a user stage correction.

- **Working details.** The lead role keeps its `lane` from `lead_lane`, `segment`, and `estimated_lease_on` with `lease_estimate_source` and optional high, medium or low confidence. An estimate always has its source; neither can stand alone. Lanes are independent of how found. `party.how_found_detail` keeps the attribution detail in every role. A merge keeps the survivor's working details, filling gaps from the duplicate, and moves an estimate with its own source and confidence. How-found detail fills only when the source agrees or the survivor had none.
- **Not kept.** The 0 to 100 lead score and named drip campaigns do not come across (owner, #196).

Moving today's rows across:

- Each `lead` becomes the lead role on its party, and each `client` the client role on its party, keeping its `created_at`. A client merged away today is not copied. A party with several leads or clients keeps the earliest `created_at` and the stage and owner of its most recently changed lead, and is listed for a partner.
- Stages `new`, `qualified`, `outreach_active`, `engaged`, `opportunity` and `archived` stay. `nurture_drip` and `closed_lost` become nurture, as the Leads screen already shows Closed-Lost. `active_deal` and `closed_won` become opportunity, since the deal holds what happened. A `do_not_contact` stage or `suppressed` lead becomes archived. Today that sets only the lead, not the person's `contact_state`, so the copy of leads lists each one for a partner to give the reason its `do_not_contact` row needs.
- `owner_id` names a partner's actor, which becomes that user. A lead with only an `owner_label` is listed for a partner, and one with neither keeps no owner.
- How found comes from `client.acquisition_source`, asked of the client, or else `lead.source_type`. Both are free text today. A `prospect-pool` lead is mapped by its candidate's own pool source. Every other value is listed for a partner to map to the list, and so is a party whose two values disagree. A lead or client with neither waits, listed, since the database refuses one without how it was found.
- A lead whose `client_id` points at a client on another party, such as the practice a doctor runs, keeps its lead role on the person, and the client role stays on the practice.
- `score`, `score_reason`, `drip_campaign`, `drip_added`, `report_back_due` and `sf_deal` do not move. Only the old spreadsheet import wrote the last four, and nothing reads them.
- Each old `lead_stage_move` becomes evidence on its lead party, keeping its id, activity, evidence reference, strength, reason and status. `nurture_drip` becomes `nurture`. Proposal creation and approval map to their respective change-history entries, retaining the old actors and dates. An undone row remains applied evidence followed by its undo in change history. A missing activity, blank evidence or reason, unknown actor or contradictory stage is listed for a user rather than invented. The owner loads historical rows without replaying the application trigger; ordinary stage events map to change history only.

- The old lane list becomes `lead_lane`, and `lead.lane` and `segment` stay on its lead role. An unknown lane or whitespace-only segment is listed for a user.
- `est_lease_event`, `event_source` and `event_confidence` become the estimate date, source and confidence. A promoted candidate's `est_basis` supplies a missing source. An estimate without a source, confidence without an estimate, unknown confidence or an unparsed `est_lease_event_raw` is listed rather than inferred.
- `client.acquisition_detail` becomes `party.how_found_detail`, otherwise `lead.source_detail` does. If both differ, the lead detail becomes a separate note activity so both survive. A detail without mapped how found waits with its source.
- `notes` becomes a note activity about the party, dated at the old row's last change. `last_touch` comes from the latest contact activity; a standalone old date or imported last-touch-stamp note with no contact activity is listed rather than invented as contact. `next_action_date` becomes the due date of a next step about the party, with text marking it as an imported lead follow-up. `notes_path` is an old file reference, not note text; its file must be copied as a document or listed for a user.
- Outreach drafts and candidates are the other slices of #286.

## Merging duplicates

The owner ruled on #196: the merged-away record disappears and everything points at the survivor. `merge_party(duplicate, survivor)` leaves a `merged_party` row, so an old link finds the survivor, moves every row that points at the duplicate, then removes it. Email matches need nothing more, because the duplicate's addresses are now the survivor's. The foreign keys then refuse any row that still names the duplicate, in any table, including tables added later. The merge finds what to move from the catalog, so a new table that points at a party moves with no change to it.

A conflict keeps the survivor's data and refuses what cannot be settled safely:

- Two people, two companies, or a person and a company? Only two of one kind merge.
- A user? A user is never merged away, because their changes name them. They can be the survivor.
- Both have an NPI? Refused. NPPES issues one number per person or organization, so two numbers are two of them. Otherwise the survivor keeps its own NPI or takes the duplicate's.
- The same email, phone number, role, specialty, company link, territory link or activity on both? One row stays, the survivor's, with its label and title.
- Both have a primary email or phone? The survivor's stays primary. If only the duplicate has one, it becomes the survivor's.
- Do not contact on either? The survivor is do not contact. If both are, the longer restriction stays with its reason, with no end date stronger than either date. Equal end dates keep the survivor's reason.
- Both on one deal in the same role? One link stays, and the duplicate's rounds move to it. In different roles, both stay.
- The survivor keeps its name. Outside ids, next steps, sent activity, social accounts and introductions all move.
- Both leads? The survivor's lead role stays, with its stage and owner, and the duplicate's owner fills a missing one. How found stays the survivor's, or becomes the duplicate's.
- Both vendors? The survivor's vendor role stays, with its stage and level, and the duplicate's fill any it lacks. The stricter disposition stays with its reason: avoid, then parked, then the survivor's. If either is a target, the survivor is, unless the merged disposition is avoid.
- A vendor and someone it introduced, or was introduced to? Refused, because an introduction joins two different records.
- A record merged into the duplicate earlier now points at the survivor, so pointers never chain.

A catalog test lists every unique key that holds a party. A new one fails it until the merge says which row stays.

## Change history

Every insert, update and delete of a stamped row writes one `change` row: the table, the record's key, whether the row was added, changed or removed, and the stamp of who made it and when. An added row's `new_value` is the whole row, and a removed row's `old_value` is the whole row. A changed row's hold only the fields it changed, from what to what. The stamp's own columns are left out, because the change's stamp names who and when. A statement that changes nothing writes nothing.

The key is the row's primary key, such as `{"id": …}` for a deal, or `{"deal_id": …, "party_id": …, "role": …}` for someone on a deal. `activity_about` and `post_review` have none, so their key is the whole row. Who moved a deal to which phase, and when, is the deal's `deal_phase_change` inserts: `table_name = 'deal_phase_change' and record ->> 'deal_id' = <deal id>`.

One trigger function, `record_change`, writes history for every table that carries the stamp, and a test fails when a stamped table has no history. It runs with the owner's rights, and no role but the owner may attach it to a table, so a temporary table cannot write history either. The engine's role reads `change` but cannot add, change or remove a row of it, so history is written only by changing a record.

A merge marks each change it makes with the duplicate it merged, in `merge_of`: each link it moves or removes, the duplicate's removal and its merged-into pointer. `merge_party` sets `engine.merge` for its own run, and the mark counts only when a merge of that record was saved in the same transaction, so setting it by hand cannot pass an edit off as an earlier merge's. Set by hand after a merge in the same transaction, it would mark an unrelated edit as that merge's; the change still names who made it and when.

Today's system keeps one `event` row per field changed, with the actor, a verb and a cause, and `/pipeline/changes` reads a deal's events. A change row holds every field one statement changed, so the old per-field rows are `jsonb_each` over its values. A copy of old rows, such as `schema/copy-parties.sql`, keeps each row's old stamp, and its history records the copy itself: an insert by `old_system`, at the time the copy ran. The old `event` rows come across later. Serving the change feed and deal events from this table is a later slice.

Only the schema owner's database role may call `erase_change(removed_change_id, fields)`. It requires a delete change and refuses a record that exists again. It removes the selected non-key text fields from old and new values for that table and record, across inserts, edits and deletions. Unknown fields, keys and non-text fields are refused. Other values stay. Keys, actions, merge pointers, authors and times stay unchanged. An `erase` change records the request with its user or job and time, with the erased field names and without copying their words. Repeating a completed erase changes nothing. The function locks the source table while it checks absence and erases, so a concurrent insert cannot recreate the record during it. The engine cannot call it or change history directly. Linked records and external copies are separate requests.

## Commissions

The owner answered walkthrough 4, topic E, on #196 (2026-11-16). A deal's gross commission, what the brokerage collects, is recorded once, on its `commission` row. An open deal can carry its expected commission there too, so the pipeline has a total. A gross is paid in parts, one `commission_payment` each, with its invoiced, due and received dates. Whether a payment is invoiced, unpaid, overdue or paid is read from those dates and today's date, never stored.

The split pays others first. Each `commission_share` gives a referring agent, the brokerage or anyone else a share of the whole. The two users split what is left. The closing user is the deal's owner. Their ladder, the `commission_tier` rows keyed by that user, gives their part by their lifetime count of closed deals, and their partner, named on the ladder, takes the rest. The count never resets: a deal is the user's nth closed deal if it is the nth they own whose latest phase is closed, by when it closed. A tier runs from its count until the next tier starts, so tiers cannot overlap or leave a gap. A single deal overrides its users' split with its own closing part. The shares and thresholds are the partners' rows, and real ones never appear in this repo, its tests or its docs.

`commission_split` works out everyone's share of each deal and its amount, so no user's take is typed. Each amount is rounded to the cent, and the partner takes what rounding leaves, so the amounts add up to the gross. A deal that is not closed yet has no count, so its users' shares wait for it to close unless it overrides them. The count and the ladder are read when asked, so a deal that closes, dies or changes owner moves the count for that owner's later deals, and a changed tier changes every deal it covers.

Moving today's rows across:

- Each deal's `commission` rows become one `commission` row. A row with status `expected` adds its `gross_amount` to the expected commission. Every other row becomes a payment of its `gross_amount`, with its `invoiced_on`, `due_on` and `received_on`, and the payments add up to the gross. A `received` row with no `received_on` is listed for a user to date.
- `deal.invoiced_on` stays with the invoices found in email, a later slice.
- `commission_allocation` has no rows, so nothing comes across. Its `referral_fee`, `house` and `other` kinds would be the referral, brokerage and other shares, and `partner_split` is the ladder.
- `sf_commission_placeholder` is not copied. Today's rule already keeps it out of every money figure.
- Today's fixed share per lane, in a report script, is replaced by each user's ladder. The partners enter their ladders themselves.

## Later slices

"Everything about this person." The rest of leads (#286). Invoices found in email. Serving confirmed critical dates and proposals. Leases negotiated elsewhere and renewal links. Serving the change feed from change history. Indexes, once real sizes are known. Market figures from outside deals. Moving the rest of today's records across. For marketing: rotation rules, lead attribution and the weekly agent loop.
