# Calendar

- **For** both signed-in partners on a computer or phone.
- **Must** show confirmed open critical dates from every open deal and both partners' open dated next steps on deals, buildings, parties with a vendor role, and people at one or more current vendor companies. Vendor roles qualify even when the party or one of the person's companies also has a lead role. A company link is current if its start is unknown or on or before today's Central date and its end is absent or after today.
- **Must never** count resolved dates or steps, or present a failed read as an empty period.

## What a partner sees

- [ ] The Month and Week icon buttons switch the calendar view. Previous and Next sit on either side of the period and move one month or week. The header counts each item in the period once and skips neighboring months' dates. Jump to today returns to the current Central time day. Back restores the period and selected day.
- [ ] Select a day or item to see that day's list in the always-open Calendar panel. On phones the panel sits below the grid. Each row says “Critical date” or “Next step,” shows the date kind or step title and owner, and links to the record. A step title follows the Home card title rules in [Home inbox](home-inbox.md#every-card). Show the full instruction below its heading when the wording differs. A building step with no single open deal shows the building inline.
- [ ] Late steps appear in one group at the top of today’s day list. Each step shows how many days late it is. The grid shows a single late-step count for today. Keep critical dates on their recorded day. Snoozed, held and dropped steps are excluded under the same rules as Today reminders.
- [ ] Coming up lists the next five dates with items after today or the selected day, whichever is later. Selecting a date opens its entries in the same panel.
- [ ] An empty period says that it has no critical dates or next steps. The Updated time shows the last successful read. Refresh reads again. Month and week navigation reuse the items already read.
- [ ] Proposals, including automation-added dates copied from the old Calendar, stay on their deal pages. Calendar lists a proposal after a partner confirms it if the deal is open.

## Where the dates come from

The app uses [the Calendar read](../new-database.md#calendar-read) with `deals-from-engine` on. The new-schema read includes `next_steps`. Older engine versions and the legacy read can return just critical dates.

A 404 from the new read allows the app to use the board and individual deal reads while the engine and app are on different versions.
