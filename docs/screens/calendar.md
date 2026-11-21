# Calendar

- **For** both signed-in partners on a computer or phone.
- **Must** show the open critical dates from every open deal, including overdue dates and deals owned by either partner.
- **Must never** include proposals or resolved dates in the count, or present a failed read as an empty period.

## What a partner sees

- [ ] Month and Week switch the grid and date list to the chosen period. The header counts every date in that period once. A month excludes the dates in its neighboring months.
- [ ] Previous and Next move one month or week. Today returns to the current Central time day. Back restores the period and selected day.
- [ ] Select a day or date to see that day's entries. Each entry gives the kind in plain words, the date, and a link to its deal page. The legend explains the urgency markers.
- [ ] An empty period says “No critical dates this month” or “No critical dates this week.” Refresh reads the dates again. Month and week navigation reuse the dates already read.

## Where the dates come from

The app uses `GET /api/engine/calendar/critical-dates` with `deals-from-engine` on. This signed-in read uses the new tables when `DEALS_READ_SCHEMA=next` and the old tables otherwise. Its `calendar-critical-dates.v1` answer returns `critical_dates` in date order. Each row has `id`, `deal_id`, `deal_name`, `kind` as a display label, `due_on` as a calendar date, and `done: false`.

A 404 from the new read allows the app to use the board and individual deal reads while the engine and app are on different versions.
