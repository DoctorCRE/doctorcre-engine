# The new database

The engine will move to a new, cleanly connected database in one planned step, after it serves every screen from today's database. This note designs the core. `schema/next.sql` holds the first slice. Tests load it into its own namespace in a throwaway database with made-up data. Nothing applies it to a live database.

## Records

- **`party`**: every person and company, once, each with its own id. `kind` is `person` or `company`. A person's `npi` is their individual NPI, and a company's its organization NPI.
- **`app_user`**: each person who uses the system, today the two partners, one row each with their person's id. `user` is a reserved word in PostgreSQL. A user still shows on timelines and deals as their person. Each user's preferences and facts will be columns here, or a child table keyed by the user, as they come.
- **`do_not_contact`**: a person or company nobody may reach out to, in any role, with the reason.
- **`specialty`**: the list of a doctor's specialties, such as general dentistry. Like roles, a label can be renamed.
- **`outside_id`**: another system's id for a person, company or deal, such as a Salesforce or roster id, kept as import history.
- **`role`**: the short list of roles, such as client, lead, vendor, lender, listing agent and property owner. A user can rename a label without touching any record.
- **`property`**: a building or space, by address.
- **`deal`**: one piece of brokerage work.
- **`phase`**: the list of deal phases, from negotiating to closed, plus dead. Like roles, a label can be renamed.
- **`deal_phase_change`**: one row each time a deal changes phase, with when, the new phase and the reason. A deal's phase is its latest row.
- **`offer`**: one round of an LOI or other offer on a deal.
- **`document`**: a file, as its name, its key in object storage (Cloudflare R2) and its type, read from the file's own bytes when the engine stores it. The file itself is never in the database. An email attachment names the email it arrived with.
- **`activity`**: something that happened: an email, a call, a meeting or a note, with when, who it came from and a summary.
- **`email`**: the email behind an email activity.
- **`next_step`**: what is due next, with its owner, due date and the time it was done.

Each record and link carries `created_at`, when its row was stored, so moving today's records across can keep their dates. Lists such as roles and phases do not, and neither do rows that carry their own time: activities and their emails, rounds, phase changes, posts and readings.

## Users and who changed what

Every row a person changes carries `changed_by_user_id`, the user who last added or changed it, and `changed_at`, when. These are the lists of roles, phases and specialties, parties and their emails, phone numbers, roles, companies, specialties and do-not-contact rows, properties, deals and their phase changes, properties and parties, rounds and their documents, activity and what it is about, next steps, social accounts, ideas and design templates. The engine names the signed-in user once per transaction with `set_config('engine.user_id', <user id>, true)`, never for the whole connection, because a pooled connection serves the next user. A trigger writes both columns on every insert and update, whatever the statement says, and refuses the change when no user is named. A name that is not a user is refused by the key. Who removed a row waits for change history.

In marketing, a text edit, a review and a sign-in also name their user. Documents, emails, posts and readings are written by jobs: the intake door, the mail capture, the publisher and the readings. Whether a job's change names a user it works for or the job itself is the owner's call (#244), so these tables carry no stamp yet. Until then, a user who settles a post stuck in `publishing` is not recorded.

Only the owner adds a user, because every change is signed with a user's id. A user who has changed anything stays, so who changed what survives; a teammate who leaves will be a column on the user. Adding a teammate is a person row and a user row. The first user's own person row names them as its author, so that key is checked when the transaction ends. Being a user is not a role on a deal: who owns a deal will be a role on the deal, as client and listing agent are.

Today's actors map across like this. The old `actor` table holds the two partners as `human`, the scheduled jobs and agent sessions as `automation`, and migrations and exporters as `system`. Its `created_by` and `updated_by` columns name an actor and are often empty, and the old `event` rows add a cause and, for an agent, the partner it worked for. Each `human` actor becomes a person with a user row. The owner loads them with the `stamp_change` triggers turned off, so a row keeps its old author and time: `changed_by_user_id` from `updated_by`, or `created_by` when never updated, and `changed_at` from `updated_at`, or `created_at`. A row an automation or system actor last changed takes the partner its event names, and the rest follow the owner's ruling on #244. The old columns that name a partner by slug, such as `deal.owner`, become deal roles in the deal-owner slice.

## Links

Each link is one row. No record holds a list or a column per role.

- **`party_role`**: what a person or company is to us. One row per role.
- **`party_email`** and **`party_phone`**: a person's or company's emails and phone numbers, one row each, with a label and whether it is the primary one.
- **`party_specialty`**: a person's specialties, one row each.
- **`party_company`**: a person at a company, with their title there and the dates they started and left. A person who moves keeps the old row, with its end date, and gets a new one.
- **`deal_party`**: who is on a deal, in which role. The client, the listing agent and each vendor are rows here.
- **`deal_property`**: the properties a deal is considering.
- **`offer_document`**: the documents of each round.
- **`activity_about`**: each deal, person or company, or property an activity concerns.

## Rules the database enforces

Each rule has a test in `src/next-database.test.ts` that fails without it. The tests work as the engine's role (see "Who may change what"), so each refusal is a constraint, a trigger that checks values, or a privilege the role lacks.

1. A link to a record that does not exist is refused, and so is deleting a record something still links to.
2. Every role on a person or a deal comes from the role list.
3. The same link is stored once.
4. A person or company is one of the two kinds.
5. A round's number is used once per deal, and a round answers an earlier round of the same deal.
6. A round comes from someone on the deal, in their role on that deal, about a property the deal is considering.
7. A round is never rewritten or removed, not even by emptying the table. Only its status changes. New terms are the next round, and `withdrawn` takes a round back.
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
29. A review is an edit, a cancel or no response, judged by the database's clock. An edit names a text version after the first, and a cancel is of a cancelled post; both name a user and come before review closes. No response names no one, comes at or after the close, only for a scheduled post with no other review. A review holds its post until it is saved, so an edit and the job writing no response take turns. Each version is reviewed once, a post is cancelled and gets no response at most once, and a review is never rewritten or removed.
30. A record or link keeps when it was stored.
31. The engine empties no table, removes no history, and changes only the columns that may change.
32. An email address is one address in lower case, with no name around it, and so is an email's sender. A person or company has each address once, labelled work or personal, and at most one primary.
33. A phone number is a plus and digits only (E.164), and a North American one is +1 and ten digits. An extension is digits only. A person or company has each number and extension once, labelled work, mobile or home, and at most one primary.
34. A change a person makes names the user who made it, and records them and the time itself. A user is a person, and only the owner adds one. A text edit, a review and a sign-in name a user.
35. An NPI is ten digits ending in its check digit, and one person or company holds it.
36. A specialty is a person's, comes from the specialty list, and is stored once per person.
37. A person or company is marked do not contact once, with a reason that is never blank and never changes.
38. An outside id is for exactly one person, company or deal, is stored once per source, and is never rewritten or removed. Its source is a lower-case name, and its value has no space around it.

Two people adding different links to one deal at the same time both keep theirs, because each link is its own row. A test proves it with two open sessions.

## Who may change what

`schema/next.sql` defines `engine`, the role the engine will use on this database. A login takes it with `grant engine to <login>`. The engine connects with `role=engine` set, or as a login created in SQL. A role made in the Neon console belongs to `neon_superuser`, and its own rights would bypass these grants. Loading the schema refuses an existing `engine` role that is a member of any role, is a superuser, bypasses row security, or can create roles or databases or replicate.

The role reads rows in every table, adds rows in every table except `app_user`, `platform_metric` and `platform_format`, and empties none. A social account it adds has no `engine_publishes_from`, so removing an account and adding it back cannot set one. A text version and a review it adds take the clock's time, which it cannot write. It removes rows only outside history, and changes only these columns:

- a role's, a phase's or a specialty's label;
- a party's, deal's, document's or design template's name, a party's NPI, and a property's address;
- a person-at-company link's title and dates;
- an email's or phone number's label and whether it is primary;
- an activity's time, sender and summary;
- a next step's text, owner, due date and done time;
- a round's status;
- a social account's handle and platform account id, and an idea's angle, hook and pillar;
- a post's status, reason, platform post id and publish time, until it is published, failed or cancelled.

History is `deal_phase_change`, `offer`, `offer_document`, `post` and its `post_text`, `post_media` and `post_review`, `measurement`, `social_sign_in` and `outside_id`. Ids, `created_at`, and the records a link or an about row joins never change; a different link is a removed row and a new one. Who an activity came from and who owns a next step can be corrected. PostgreSQL refuses anything else before it touches a row, so a save runs no trigger just to be told no. Besides the stamp that writes who changed a row, the triggers left check values: a round's status moves, a later acceptance superseding a round, an email about a record, a post's status moves, a post that is final, the engine's start time for an account, an edit or review inside its window, and a reading of a published post.

The owner's own login can still change anything. That path is not the engine's concern.

## Emails and phone numbers

A person or company can have several emails and phone numbers. Each is a row in `party_email` or `party_phone` with a label, and one of each may be primary. A changed address or number is a removed row and a new one.

Each is stored in one form, so a repeated address or number is caught (decision 32). The database checks the form and does not convert; whoever writes a row converts first. An email address is lower case ASCII, with no display name. A phone number is E.164, such as `+12175550100`, and an extension such as "x12" is its own column. The same address or number can be on two parties, such as a shared front desk. Two parties that turn out to be one person are merged in a later slice.

An email's `sender` is stored in the same form, so the agent finds who sent it by matching `sender` to `party_email.address`, and sets the activity's `from_party_id`. The rows are keyed address first, so that match is a lookup.

Today's `party` row holds one free-text `email`, `phone` and `cell` on each person and company, as typed. Moving them across:

- `phone`, the office line, becomes a work number, primary. `cell` becomes a mobile number, primary when there is no `phone`.
- A ten-digit number, with or without a leading 1 and in any punctuation, becomes +1 and its ten digits. A trailing extension moves to `extension`.
- `email` sometimes holds several addresses, or a name with the address in angle brackets. Each address becomes its own work row, lower case and trimmed, and the first is primary.
- The same number or address twice becomes one row. `cell` is primary when no `phone` row is stored.
- A value that fits neither form is not stored. The move lists it for a partner to fix.

## Do not contact, NPIs and outside ids

Do not contact is a fact about the person or company, whatever roles they hold, so a lead, a client and a vendor contact are all covered by one row. The owner: "the only time we would make someone do not contact it would be for any reason." Its row is keyed by the party alone, so any outreach finds it with the party's id. It carries the reason, and its stamp says which user set it and when. The reason never changes, so the stamp stays the time it was set; lifting it removes the row.

An NPI is checked for shape: ten digits, the last a Luhn check digit over the prefix 80840 and the first nine. The first digit is not checked, so tests use made-up numbers starting with 9, which no NPI issued yet does. NPPES issues each number once, to a person or an organization, so the number is unique across both. A doctor's specialties are rows in `party_specialty`; a company has none.

Old reference ids, such as Salesforce ids and roster numbers, are kept in `outside_id` only to trace where a record came from. Nobody types or searches for them, so they are not party or deal columns. A source and value are stored once, so a repeated import finds the record it already made.

## Offer rounds

Every LOI, counter and response is a new `offer` row. It holds its round number, the round it answers, who sent it and in what role, when, and its status: `open`, `countered`, `accepted`, `rejected`, `withdrawn` or `superseded`. The standard terms are typed columns, so the app can show what changed from one round to the next: rent and estimated NNN per square foot per year, term in months, TI per square foot, free rent months, yearly escalation percent, and when rent starts, as a date or as a number of days after delivery. Each later term is one more column.

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

## Marketing

The owner's automation keeps posting as it does today. These tables record what went out and how each post did, so each week's posts can learn from earlier ones.

- **`social_account`**: a presence on X, LinkedIn, Facebook or Instagram, by its handle, owned by a party. "Account" alone means a national account (`docs/glossary.md`). It holds the platform's own id for it, learned at sign-in, and `engine_publishes_from`, the time from which the engine publishes its posts.
- **`social_sign_in`**: one row each time a user signs in to a platform for an account: who, as which platform account, when, when it expires, and the scopes granted. The token itself lives in Workers KV, never in the database. A Facebook Page's sign-in does not expire, so it has no expiry.
- **`platform_format`**: the formats each platform takes, one row each: text, photo, photo set (several photos or a carousel), document (a PDF carousel, LinkedIn only) and video (a Reel on Instagram). Instagram takes no text-only post, and Facebook no photo set. X keeps its rows for the posts already sent there. Only a schema change adds one.
- **`idea`**: what a post says, as its angle, hook and pillar. One idea can run on several accounts.
- **`design_template`**: a reusable look that a post's image is made from.
- **`platform_metric`**: the metrics each platform reports, one row each. LinkedIn and X do not report saves, for example. The rows are a guess, to be confirmed against each platform's API. Each row says from when posts must have the metric. The first rows hold from the start, and a row added later holds from when it is added, so older posts, which have no reading of it, stay in the day-7 comparison. Only a schema change adds one.
- **`post`**: one post on one account, with its format, idea, design template, when it was scheduled, and its status. A post without an idea or a template still counts for its account.
- **`post_text`**: a post's words, one row per version. The weekly batch writes version 1. A user's edit is the next version, with its author and time, so nothing is overwritten. The latest version is the one posted.
- **`post_media`**: a post's files in order, each a `document` in R2.
- **`post_review`**: what happened in review: a user's edit, naming its text version, a user's cancel, or no response, written when review closes on a post nobody touched.
- **`measurement`**: one reading of one metric of a post: when it was taken, its source and its value. A reading of a metric the post's platform does not report is refused, and so is a reading before the post is published. A reading that could not be taken is stored as not measured, with its reason, so a gap never reads as zero.

A post goes out unless a user cancels it. `scheduled` means the engine will publish it. At its time the publisher claims it by moving it to `publishing` with `where status = 'scheduled'`, so only one run can send it. It then becomes `published`, with the platform's id and time, or `failed`, with the platform's error as its reason. A post stuck in `publishing` is resolved by a user to one or the other, never sent again. A cancelled post keeps its reason. Users edit or cancel until review closes, an hour before the post's time, and each edit or cancel is a review row. A post another publisher sent, such as Blotato, is stored as `published` or `failed` from the start.

One publisher holds each account at each minute. The database refuses a scheduled post, or a claim, before its account's `engine_publishes_from`, and an account without one never gets an engine post. The weekly batch sends earlier posts elsewhere. Moving the time later stops new claims at once, and the engine cancels the posts it no longer holds. The engine's role cannot set or change the time, even on an account it adds; the owner sets it at each cut-over.

Ratios are calculated when read, never stored. Engagement is the sum of the reactions, comments, shares and saves that the post's platform reported when it was published, and engagement per view divides it by views. After a metric is added, newer posts sum more metrics than older ones, so best and worst across that date lean toward newer posts.

`posts_at_day_7(as_of)` compares posts at the same age, because a post's numbers keep growing for days. Each post is judged by its latest reading of each metric at or before 168 hours after it was published. It returns, per account, how many posts it compared and the best and worst by engagement per view.

A post is left out while it is younger than 7 days, when it has no reading by day 7 of views or of an engagement metric its platform reports, or one whose latest reading by day 7 was not measured, or when it had no views.

Best and worst stay within one account, so they compare like with like. Averages per idea and design template come next (#206). They can mix platforms that count engagement differently, so each will show how many of its posts are on each platform.

Each ranked post carries `reading_age_hours`, the age of the oldest reading it was judged on. A post read only on day 3 shows 72, so the weekly loop and the Marketing screen can see it was judged early.

Pillars and hooks are text for now. They become lists, like roles and phases, with the rotation rules.

## Later slices

Deal type, owner and dates. Merging duplicates (#252). "Everything about this person." Leads and their conversion to clients. National accounts and franchisees. Leases, critical dates and commissions. Change history. Indexes, once real sizes are known. Moving today's records across, where the old party kind `org` becomes `company`. For marketing: rotation rules, lead attribution and the weekly agent loop.
