# Doc

- **For** each signed-in partner, on a computer or phone.
- **Must** answer questions about deals, leads, clients, and the partner's own mail. Keep each partner's conversations private.
- **Must** wait for the partner to confirm a note, next step, or pending reply draft. A reply started on Home still sends from its review. An email written in a [Doc session started from a button](#start-doc-from-a-button) sends from that session, only on **Approve and send**.

The owner approved this design on 2026-11-25. Check each line on a signed-in app against the practice copy, at 1280x640 and 1440x900 on a computer and at 390px on a phone, with made-up data.

- [ ] **Doc link** on Settings, opened from the account menu, shows the signed-in partner's Mac status. It uses the waiting wording under [Ask a question](#ask-a-question). A ready Mac shows "Doc is ready on your Mac." The partner can make, replace or revoke their own link code. Each new code appears once.

## On a computer

- [ ] **Ask Doc** in the app shell opens `/doc-chats`. The search orb still searches. Any partner-facing instruction to ask Doc points to this chat. The chat shows only questions, answers, and proposals for the signed-in partner.
- [ ] The page never scrolls. Only the conversation scrolls, and the chats list scrolls on its own when it is long. A chat opens at its latest turn.
- [ ] The chats list is always open on the left, 264px wide, with no heading. Each row is one 36px line with no underline. It shows the start of the chat's first question, and its time on the right. Newest chat first. The open chat's row has a filled background.
- [ ] A row's time is the time of the chat's newest message. A message from today shows its time ("2:14 PM"). One from the last 6 days shows its weekday ("Tue"). An older one shows the month and day ("Nov 12"), with the year when it is not this year ("Nov 12, 2025").
- [ ] A chat's row shows a spinner while Doc works on it, and an amber dot while a save waits for the partner's OK or Doc has a question for the partner.
- [ ] The **New chat** pencil sits at the top of the list. **Older chats** is a quiet last row that loads the next page, shown only when there is one.
- [ ] The top bar reads "Ask Doc / " and the open chat's first question. The title shows once.
- [ ] The conversation is one centered column 728px wide. The partner's question is a rounded box on the right, at most 80% of the column. Doc's answer is plain text on the page, with no box, and may use bold names and bullets.
- [ ] Under an answer, each record Doc used is a small chip with an icon for a deal, a person or an email. A chip opens that exact deal, lead, client, or mail review.
- [ ] The typing box is one rounded card pinned to the bottom of the column. It starts one line tall and grows as the partner types. Inside, `@` sits on the left and the round **Send** button with an up arrow on the right. The paperclip joins `@` when [attaching a file](#coming-later) arrives.
- [ ] Under the typing box, one small line says whether Doc can answer now. A green dot and "Doc is ready on your Mac" when it can, or the waiting wording when it cannot.

## On a phone

- [ ] The conversation fills the screen. The top bar has the **Recent chats** list icon on the left, the chat's title, and the **New chat** pencil on the right.
- [ ] The list icon slides the chats in from the left over the conversation. Choosing a chat closes the list and opens that chat.
- [ ] The typing box is pinned above the bottom menu and stays in view.
- [ ] The Doc status line is hidden while Doc is ready and shows when Doc cannot answer yet.
- [ ] Text is 16px and every button is 44px. The question, source chips, save card and buttons fit without sideways scrolling.

## A new chat

- [ ] **New chat** clears the typing box and starts an empty chat. The first send creates the conversation.
- [ ] A new, empty chat shows the typing box centered under "What do you need?" with the hint "Ask about a deal, a lead, a client or your mail". After the first question the box docks at the bottom and its hint reads "Ask Doc". On a phone it sits just above the bottom menu.
- [ ] A partner with no chats sees "No conversations yet" in the list and can send a first question.

## What each control does

| Control                                                                              | What it does                                                                                                                       |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| A chat row                                                                           | Opens that chat with its saved questions and answers in order                                                                      |
| **New chat** (pencil)                                                                | Starts an empty chat and clears the typing box                                                                                     |
| **Older chats**                                                                      | Loads the next page of chats                                                                                                       |
| **Recent chats** (list icon, phone)                                                  | Shows the chats over the conversation                                                                                              |
| Enter                                                                                | Sends. Shift+Enter starts a new line                                                                                               |
| **Send** (up arrow)                                                                  | Sends. Grey when the box is blank, over 4,000 characters, or a question in this chat is queued or working                          |
| Character count                                                                      | Hidden below 3,500 characters. From 3,500 it reads like "3,650 / 4,000"                                                            |
| `@`                                                                                  | Opens a picker of deals, leads and clients. The pick shows as a chip in the typing box, and Doc answers about that record          |
| A source chip                                                                        | Opens that exact deal, lead, client, or mail review                                                                                |
| A match chip                                                                         | When Doc asks which record the partner meant, each match is a chip with its city and how many deals it is on. It opens that record |
| **Save note**, **Save next step**, **Save draft and open review**, **Save revision** | See [Confirm a save](#confirm-a-save)                                                                                              |
| **Retry**                                                                            | See [Ask a question](#ask-a-question) and [Confirm a save](#confirm-a-save)                                                        |

- [ ] **Send**, **New chat** and **Recent chats** are icon buttons with those names for screen readers and on hover: a round up-arrow for **Send**, a pencil-on-square for **New chat**, and the chats list toggle for **Recent chats**.
- [ ] The character count is hidden until the question reaches 3,500 characters, and turns red past the 4,000 limit.

## Ask a question

- [ ] Sending shows the question once and a line where the answer will land with a spinner and "Doc is working · 12s", counting seconds. While a question is queued or working, the next question waits in the typing box until the partner can send it.
- [ ] The reply is text with source chips for the exact records used. When more than one record could match, Doc asks which one and shows match chips for the records the partner can open. When a record is unavailable, Doc says so without showing facts from it.
- [ ] On a question about mail, Doc can list the partner's pending mail priorities and answer from the exact message in a review. The source opens the existing Home review. Mail without verified membership in the partner's mailbox is unavailable.
- [ ] A queued question stays visible. Where the answer will land, a still grey dot and one sentence say why it waits. Before setup, "Doc isn't set up on your Mac yet." While the Mac is offline, "Doc answers when your Mac is on." If Doc needs a fresh sign-in, name the model when the engine knows it. Say "Sign in to Claude Code on your Mac." or "Sign in to Codex on your Mac." Otherwise say "On the Mac that runs Doc, sign in again to the AI app Doc was set up with." If the plan limit is reached, say "Doc is paused until your Claude Code plan resets." or "Doc is paused until your Codex plan resets." If the model is unknown, say "Doc is paused until your model's plan resets." While a ready Mac has work ahead of this question, "Doc is waiting for a free slot on your Mac." When the backup is also unavailable, Doc answers when the Mac can run it.
- [ ] A backup answer has a small grey line under it, "Answered by backup".
- [ ] If an answer fails, the question stays visible. The latest failed question offers **Retry** when `draft_review` is null or `current` is `pending_same`. Retry uses the same question and fills in its answer once. For `current` of `changed` or `gone`, the failed draft turn asks the partner to open a fresh review. The engine checks the saved draft version again on retry.
- [ ] An unsupported action gets a plain explanation and makes no business change. Mail content cannot authorize a save or access to another mailbox.
- [ ] Reloading an open chat brings back the saved conversation and each question's current state. Switching partners clears the previous partner's chat from the screen. A signed-out tab asks the partner to sign in again.
- [ ] While the chats list or an open chat loads, the page says it is loading. If the read fails, it says the chats could not be loaded and offers **Retry**. An old `/doc-chats?id=…` or exact-turn link to an old conversation says "This older conversation wasn't kept" and offers **New chat**. An unknown new link says "Conversation unavailable".

## Confirm a save

- [ ] A proposal is one outlined card in the column. It names what it is and where it goes ("Next step on" and the record), the text to edit, the date, whose it is, and one save button. The partner can edit the note or next-step text, the next-step date, or the reply subject and body before saving. An unanswered or ambiguous choice shows no save button.
- [ ] **Save note** adds the note to that record. **Save next step** adds the partner's own step. Once the save returns, the card becomes one line with a green check, such as "Saved next step on" and the record, linked to it. If the partner already has an open step there, Doc links to the record to edit it.
- [ ] **Save draft and open review** opens the review for the exact new draft, even if another reply leads the conversation card on Home. A draft already on the email, or a pending draft answering another email in the same conversation and mailbox, keeps its saved text, and Doc's new wording is not used. Doc then stays on the chat and shows "Opened your saved draft. Doc's new wording wasn't used." with an **Open reply review** link to that draft. The partner reviews and submits mail in that review.
- [ ] **Talk to Doc about this draft** in reply review opens Doc with the exact pending draft and its source email. Doc can propose a revised subject, body, or both. Edit the proposed text and choose **Save revision** to update that draft and return to its review. A newer revision or a draft that has left pending needs a fresh review. **Send reply** stays in reply review.
- [ ] If a save fails, the edit stays visible and the message says what happened. A lost response offers **Retry** for the same save. A target or step that changed asks the partner to open the record or ask Doc again. Reloading after success shows the saved result once.

## Start Doc from a button

One pattern serves every button that hands a job to Doc: **Build client website**, **Draft requirement email** and **Compare LOIs** on a deal, and **Reach out** on a lead. A new job adds one row to the [skill list](../new-database.md#doc-skill-sessions), not a new screen. What each skill does inside its session is not designed here. The engine parts are not built yet.

- [ ] The button sits on the record and starts with a verb that says what Doc will do.
- [ ] Clicking it opens Ask Doc in a new chat named for the job and the record, such as "Ask Doc / Client website for Example Dental". The chat's first line says where it started, such as "Started from Example Dental, second office · Client website". The record's name opens the record.
- [ ] Doc checks the records before it asks anything. Its first message lists what it already has, then asks only for what is missing, as a short numbered list.
- [ ] The partner answers in the chat. A file dropped on the typing box is filed to the record's Documents and shows as a chip, and Doc reads it there. The box's placeholder names what the job wants, such as "Drop MLS reports or paste property links".
- [ ] A long job runs on its own. Doc says "You will get a notification when it is ready, or sooner if I have a question." The partner can leave.
- [ ] When the job finishes or Doc has a question, the partner gets an app update and a phone push, such as "Client website ready for Example Dental" or "Doc has a question about Example Dental's website". It opens the result or the chat.
- [ ] From then on the button shows the job's state, such as "Building client website · Started 2:14 PM", "Doc has a question · Answer", then "Update client website · Built Nov 9". Clicking it reopens the same chat.
- [ ] The result is saved to the record: the website on the deal, the comparison sheet in the deal's Documents, or the sent email in the deal's or lead's Activity.

| Button                                                   | Where                               | Doc first checks                                                   | Doc asks for                                                                       | Result                                         |
| -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Build client website**, then **Update client website** | Deal Overview, Client portal, Tours | Client, market, size, use, must-haves from calls and notes         | Which properties (MLS reports dropped in, or links), what to show, what to feature | The site, linked on the deal                   |
| **Draft requirement email**                              | Deal Overview                       | Requirements, market, timing, brokers already on the deal          | Anything missing, and who it goes to                                               | An email, approved and sent                    |
| **Compare LOIs**                                         | Deal Overview                       | Every LOI filed on the deal                                        | Missing LOIs, dropped in                                                           | A comparison sheet in the deal's Documents     |
| **Reach out**                                            | Each lead                           | The lead's record and earlier contact, then research on the person | A few questions                                                                    | An email, approved and sent, saved to the lead |

### Approve and send

A job that writes an email ends with one card in the chat. The requirement email, lead outreach and any later email job use it.

- [ ] The card shows To, Subject and the body, each a plain text box the partner can type in. Under its top line it says where the email goes from and where it is saved, such as "Email from your CARR mailbox · saved to the lead when sent".
- [ ] **Approve and send** is the one orange button. It sends exactly the text on the card from the signed-in partner's own mailbox. Nothing sends before that click.
- [ ] **Ask Doc to revise** returns to the typing box. Doc rewrites the same card and keeps the partner's edits unless asked to change them.
- [ ] After sending, the card becomes one line with a check, such as "Sent to Example Dental · saved to the lead". If sending fails it says "Couldn't send. Your draft is saved." and offers **Retry**.
- [ ] A requirement email lists each broker on the To line, and each broker gets their own copy.

See [Send a new email from Doc](../new-database.md#send-a-new-email-from-doc).

## Kept from our rules

- [ ] **Send** is neutral. The save button is the one orange button in view.
- [ ] No microphone, right-hand panel, search over chats, rows that list Doc's steps, or model picker in the chat. The model choice lives on Settings.
- [ ] Tones, type sizes and spacing come from the app's tokens. A chat uses three text sizes, and a new chat four. See [design principles](../design-principles.md).

## Choose who answers, watch it arrive, see it drawn

The owner approved these on 2026-11-25. None is built yet. Each line replaces any line above that says otherwise once its unit ships. The engine side is [Planned Doc changes](../new-database.md#planned-doc-changes).

- [ ] **Who answers** on Settings, under Doc link, lists each model the partner's Mac reports: Claude, Codex, Grok and Gemini. Each row shows "Ready", "Sign in on your Mac" or "Paused until 4:40 AM". A partner whose Mac reports only Claude sees no picker.
- [ ] The partner picks a first choice and may pick a second. Each choice offers the models and effort levels its tool lists, with the tool's default first. Saving applies from the next question in every chat.
- [ ] A chat started on one model continues on another with its earlier questions and answers.
- [ ] When the plan limit gives a reset time, the waiting line reads "Doc is paused until 4:40 AM". Without one it reads "Doc is paused until your Claude plan resets", with the paused model's name in place of Claude.
- [ ] An answer from any model but Claude on the Mac has a small grey line under it, "Answered by Codex", "Answered by Grok", "Answered by Gemini" or "Answered by backup".
- [ ] While Doc works, the answer appears as Doc writes it, as plain text. Before the first words the working line says what Doc is doing, such as "Looking up Example Dental · 4s". Source chips, visuals, suggestions and a save card appear when the answer finishes.
- [ ] While a question is queued or working and the typing box is empty, **Send** becomes a square **Stop**. Stop cancels that question, and its line reads "Stopped". The partner can ask again.
- [ ] Once the partner types, the button is **Send** again, and the question waits as a grey line under the current answer, "Sends when Doc finishes", with **Edit** and **Remove**. Only one question can wait, so **Send** is grey while one does. The waiting question sends itself when the answer ahead ends.
- [ ] Up to three suggestion chips sit under an answer, such as "Draft a reply to the landlord". Tapping one fills the typing box and sends nothing.
- [ ] When a visual explains better than text, the answer shows a table, a chart or a diagram under its text, each with a short title.
- [ ] A table has headings and rows. A cell that names a record opens it.
- [ ] A chart is bars or a line with labelled values. Hovering or tapping a bar or point shows its value and the records it came from, and each record opens.
- [ ] A diagram is a flowchart or timeline drawn in the app's tones. A record it names appears as a source chip.
- [ ] A visual fits the 728px column. A wide table or diagram scrolls sideways inside its own box, never the page. On a phone it fits the screen the same way.

## Coming later

- **Attach a file.** The paperclip will attach a PDF or photo for Doc to read, shown as a chip in the typing box with an x to remove it. It needs a design in `docs/new-database.md` first.

The engine owns the [conversation and turn contract](../new-database.md#doc-conversations-and-turns). Mail jobs that need judgment use the partner's link after any waiting chat turns and stay out of the chats list. Verify these lines as both partners, including a mailbox the other partner cannot open.
