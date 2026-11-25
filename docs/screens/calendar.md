# Calendar

- **For** both signed-in partners on a computer or phone.
- **Must** show confirmed open critical dates from every open deal and both partners' open dated next steps on deals, buildings, parties with a vendor role, and people at one or more current vendor companies. Vendor roles qualify even when the party or one of the person's companies also has a lead role. A company link is current if its start is unknown or on or before today's Central date and its end is absent or after today.
- **Must never** count resolved dates or steps, or present a failed read as an empty period.

## What a partner sees

- [ ] The Month, Week and Day icon buttons switch the calendar view. Previous and Next sit on either side of the period and move one month, week or day. The header counts each item in the period once and skips neighboring months' dates. Today opens the Day view of the current Central time day. Back restores the period and selected day.
- [ ] The whole month fits one screen at common laptop and desktop sizes, without the page scrolling (owner, 2026-11-24).
- [ ] Day view is an hour-by-hour timeline, like Outlook's day view. Meetings and tours sit at their times. All-day items, such as next steps and critical dates, sit in a band at the top (owner, 2026-11-24).
- [ ] Items without a date show as a chip, such as "3 without a date". It opens their list in the Calendar panel.
- [ ] Select a day or item to see that day's list in the always-open Calendar panel. On phones the panel sits below the grid.
- [ ] Every entry follows one template, in this order (owner, 2026-11-25):
  1. What it is and who owns it: “Next step”, “Critical date”, “Meeting” or “Tour”, then “Joe”, “Dell” or “Joe and Dell”.
  2. What to do: the step title, the date kind, the meeting title, or the tour's stops. A step title follows the Home step title rule in [Home inbox](home-inbox.md#every-item). The full instruction follows when the wording differs.
  3. What it is for, linked: “Deal”, “Vendor” or “Building” and its name. A meeting names its matched deals, or else the matched person or company, and leaves this line out when nothing matches. A building step with no single open deal names the building without a link.
  4. When: the due day, with how many days late when it is late, or the meeting's time.
  5. Reserved: a short assistant-written summary of the record's history. It is later engine work and is not shown yet.
- [ ] Month cells show each entry's action as space allows. Week and Day cells add what it is for and the owner.
- [ ] Late steps stay on their own due day. Today's list also starts with a Late group of every late step. Today's cell lists those late steps like any other entries, never as a bare count. Keep critical dates on their recorded day. Snoozed, held and dropped steps are excluded under the same rules as Today reminders.
- [ ] Coming up lists up to five dates with items in the 14 days after today. It counts from today, not from the selected day. Each item follows the template without the day it sits under. Selecting a date opens its entries in the same panel.
- [ ] An empty period says that it has no critical dates or next steps. The Updated time shows the last successful read. Refresh reads again. Month and week navigation reuse the items already read.
- [ ] Proposals, including automation-added dates copied from the old Calendar, stay on their deal pages. Calendar lists a proposal after a partner confirms it if the deal is open.

## Where the dates come from

The app uses [the Calendar read](../new-database.md#calendar-read) with `deals-from-engine` on. The new-schema read includes `next_steps`. The app places each step on its `due_on` day and does not use `display_on`. Older engine versions and the legacy read can return just critical dates.

Both partners' Outlook meetings and planned tours for the shown period come from [the Calendar meetings read](../new-database.md#calendar-meetings-read), one call per month or week. Each partner's meetings keep Today's freshness notes, and a failed partner section is not an empty period.

A 404 from the new read allows the app to use the board and individual deal reads while the engine and app are on different versions.
