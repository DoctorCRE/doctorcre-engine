# Design principles

Every app screen follows these ten rules. They come from three apps the owner named on 2026-11-25: [Gr8r Studio](https://github.com/gr8rstudio/gr8r-studio) (styles read at commit `904205c`), Linear (its [2024 redesign post](https://linear.app/now/how-we-redesigned-the-linear-ui), its [2026 refresh post](https://linear.app/now/behind-the-latest-design-refresh) and their screenshots) and [T3 Code](https://t3.codes) (the product screenshot on its site). Gr8r Studio's figures come from its styles. Every T3 Code and Linear observation comes from one public screenshot or post, so each figure for those two apps is an estimate.

To check a screen, load it with made-up data at 1280x640 and 1440x900 and apply all ten tests. Test 9 adds 1920x1080. A screen's content comes from its file in `docs/screens/`. This guide covers how that content looks. Sizes and colors come from the app's tokens.

The owner's rulings win. Where a reference app does something the owner ruled against, the principle says so under **Ruling**. Learn from Gr8r Studio's look and never copy its code, which has no license.

## 1. Density: show more rows, not taller rows

**Seen.** Gr8r Studio's list rows are 40px, or 34px in its compact setting, and its buttons are 26 to 36px tall. One Linear screenshot shows about 13 two-line notifications beside an open issue. T3 Code's screenshot fits a project, a title and a branch into each thread row.

**Rule.** On a computer a one-line row is 34 to 40px tall, a two-line row is at most 64px, and a control is 28 to 32px. A phone keeps 44px touch targets.

**Test.** At 1280x640, a list of 20 records shows at least 11 one-line rows or 7 two-line rows without scrolling.

## 2. Header height: one bar and one toolbar row

**Seen.** Gr8r Studio's top bar is 46px and its view toolbar is one 44px row. Linear's refresh post draws a location bar, a view bar, then content. T3 Code's screenshot shows one bar of about 50px with the thread's title and three icon buttons.

**Rule.** On a list or board page, above the main view sit one 48px top bar with the page title and its actions, and at most one 48px toolbar row. A second title, a title card, a count line or a legend row never sits there.

**Test.** The first row of the main view starts 112px or less from the top of the window, and the page title shows once.

A detail page may add back/title, the facts line its screen file requires and a tab strip, and the tab strip ends within about 200px of the top at 1280x640. Calendar keeps the header count `docs/screens/calendar.md` requires.

**Ruling.** Gr8r Studio's Home adds a greeting and a subtitle under its top bar. The owner ruled for compact headers (2026-11-24) and against a greeting on Home (2026-11-20).

## 3. Spacing: one scale and one left edge

**Seen.** Gr8r Studio spaces everything on a 4px scale and starts its page name, toolbar, list and board on one left edge. Linear's redesign post describes aligning labels, icons and buttons "both vertically and horizontally". T3 Code starts every line of its sidebar on one edge.

**Rule.** Every gap and padding is a step on the app's spacing tokens (4, 8, 12, 16, 24, 32 and 48px). The page title, the toolbar's first control and the content's first column share one left edge.

**Test.** A vertical line down the left edge of the page title also touches the toolbar and the first column of content. The gap under the toolbar, the gap between two rows or cards, and a row's side padding are each a step on the scale.

## 4. Type: few sizes, with weight and tone doing the work

**Seen.** Gr8r Studio sets row and card names at one body size, metadata and controls a step smaller, and only a page heading larger. Linear keeps one face for the interface and a display cut for headings. T3 Code sets a thread's title at body size and separates the title from the lines around it by brightness alone.

**Rule.** A screen uses at most four text sizes, all from the app's type tokens. Body text comes from one token. It is 14px on a computer and 16px on a phone. Rows, cards and controls use the body size for the name and the caption size for everything else. Weight and the muted tone make the rest of the hierarchy.

**Test.** The screenshot has four or fewer distinct text sizes. Body text measures 14px on a computer and 16px on a phone. No text inside a row, card or control is larger than body text.

## 5. Color and borders: neutrals carry the screen and lines stay faint

**Seen.** Gr8r Studio builds a screen from neutral surfaces, four text tones and one accent, and keeps green, amber and red for status. Linear's refresh post says "Structure should be felt not seen" and reports fewer, softer separators. T3 Code is close to monochrome.

**Rule.** The accent fills at most one primary action per view, and any other color marks a status or the selection. Spacing and surface tone separate things first, then a hairline. No outline surrounds the sidebar, a board column or a group of toggles.

**Test.** The screenshot has at most one accent-filled button. Every other color marks a status or the selection. No box is drawn around the sidebar, a column or a control group.

**Ruling.** Gr8r Studio draws a line beside its sidebar and around each board column. The owner ruled against a border around phase columns, a visible sidebar border and bordered toggles (2026-11-20).

## 6. Cards and rows: rows for lists, cards for lanes and tiles

**Seen.** Gr8r Studio shows tasks as rows in its list and table, and as cards only on its board, where each card is dragged between columns. Its Home panels hold plain rows. Linear's inbox and T3 Code's thread list are rows.

**Rule.** Records that a partner scans or compares in a list are rows. Cards belong in every board lane, whether or not a partner drags them, in Home tiles, and where a screen file names cards, such as Closed deals, Lost deals and National Accounts. A deal card in a phase column shows the deal's name, its owner and one small badge when the deal needs attention. No card sits inside another card.

**Test.** Each card in the screenshot sits in a board lane, in a Home tile, or where its screen file names cards. A deal card in a phase column shows no next step, due date, late count or automatic-move notice. No bordered or shadowed box holds another one.

**Ruling.** The owner ruled on 2026-11-20 that a deal card shows only the deal's name, its owner and one attention badge. That ruling wins over a screen file, and [Deals](screens/deals.md#card) follows it. The star on each card is a later owner ruling (2026-11-24).

## 7. Empty states: one plain line, or nothing

**Seen.** Gr8r Studio's empty list shows a short heading such as "Nothing overdue", one sentence, and one button that fills the list. Linear shows an empty field as a muted prompt that is also the action, such as "Set priority". T3 Code's screenshot folds finished threads into one counted line, "Settled 43".

**Rule.** An empty main view says so in one plain line and offers the one action that fills it. Home does not draw an empty section or tile. On every other screen an empty section follows its screen file, and [Deals](screens/deals.md#everywhere-on-deals) has the section say so in plain words. A failed read says what is unavailable and never looks empty.

**Test.** With no records, the main view shows one line and at most one action. Home shows no empty section heading. With the read blocked, the screen names what is unavailable.

**Ruling.** Gr8r Studio adds a sentence of explanation under each empty heading. The owner ruled against explainer text, so the line stands alone, and ruled that Home hides an empty section (both 2026-11-20).

## 8. Motion and hover: answer the pointer, then stay still

**Seen.** Gr8r Studio changes a row's fill on hover in 140ms and lifts a card by 1px. During a drag, an accent line marks the landing place. It swaps every animation for a short fade when the system asks for reduced motion. T3 Code animates only a spinner beside work in progress. Linear's posts and screenshots are static and show no motion to compare.

**Rule.** Every clickable item changes fill or text tone on hover and shows a focus ring on keyboard focus, using the app's duration tokens (120 to 300ms). A dragged card shows where it will land. Nothing else moves, pulses or flashes unless work is in progress.

**Test.** Compare a screenshot at rest with one where the pointer is on a row, a card and an icon button. Each hovered item differs and nothing else changed. In a five-second idle recording, nothing moves except a spinner beside work in progress.

**Ruling.** The owner removed a flashing status chip from Calendar on 2026-11-20. Background work shows as an Updated time.

## 9. One-screen fit: regions scroll and the page does not

**Seen.** Gr8r Studio's board and calendar fill the height under the toolbar. Each board column scrolls inside itself, and the calendar's week rows share the height. Linear holds its inbox list and the open issue side by side in one window. T3 Code pins its title bar and composer and scrolls only the conversation between them.

**Rule.** On a computer the page does not scroll. The main view fills the height under the header, and long content scrolls inside its own region under a fixed header row. A phone page may scroll.

**Test.** A full-page screenshot at 1280x640, 1440x900 and 1920x1080 is exactly the window's height, with the whole month, the full height of the board or the first 11 rows in view.

**Ruling.** Gr8r Studio's Home scrolls as one long page. The owner ruled that each page's main view fits one screen (2026-11-24).

## 10. Labels and wording: name the thing and skip the explanation

**Seen.** Gr8r Studio's labels are a few plain words in sentence case, such as "New task", and its dates read "Today", "Fri" or "Oct 18". Linear's actions are verbs such as "Snooze". T3 Code gives a thread's status in one word, such as "Working".

**Rule.** A label is the shortest plain wording, in sentence case. A name from `docs/glossary.md`, such as a phase or a tab, keeps the glossary's capitals. An action button starts with a verb. Navigation, a tab or a toggle may be a noun. A title says what happened or what to do. No sentence explains a section, and no code or raw timestamp appears. A Central time carries no zone label. A time in another zone names its zone.

**Test.** The screen fails on a sentence that says what a section is for, a record shown by a code and not by its name, a date such as `2026-11-19`, a "Central", "CST" or "CDT" label, a time in another zone with no zone label, an action button that does not start with a verb, or a title-case label that is not a glossary name.

**Ruling.** Each app shows codes in the sources read, such as Linear's issue keys. Our screens show a record's name, never its code, as [Deals](screens/deals.md#everywhere-on-deals) requires. Gr8r Studio's Home subtitle is the explainer text the owner ruled out on 2026-11-20. A ruling of 2026-11-24 removed the Central label, because both partners work in Central time.
