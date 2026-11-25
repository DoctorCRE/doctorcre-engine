# Doc

- **For** each signed-in partner, on a computer or phone.
- **Must** answer questions about deals, leads, clients, and the partner's own mail. Keep each partner's conversations private.
- **Must** wait for the partner to confirm a note, next step, or pending reply draft. Sending a reply stays in the existing review.

The owner approved this design on 2026-11-25. Check each line on a signed-in app against the practice copy, at 1280x640 and 1440x900 on a computer and at 390px on a phone, with made-up data.

- [ ] **Doc link** on Settings, opened from the account menu, shows the signed-in partner's Mac status. It uses the waiting wording under [Ask a question](#ask-a-question). A ready Mac shows "Doc is ready on your Mac." The partner can make, replace or revoke their own link code. Each new code appears once.

## On a computer

- [ ] **Ask Doc** in the app shell opens `/doc-chats`. The search orb still searches. Any partner-facing instruction to ask Doc points to this chat. The chat shows only questions, answers, and proposals for the signed-in partner.
- [ ] The page never scrolls. Only the conversation scrolls, and the chats list scrolls on its own when it is long. A chat opens at its latest turn.
- [ ] The chats list is always open on the left, 264px wide, with no heading. Each row is one 36px line with no underline. It shows the start of the chat's first question, and on the right its time ("9:12 AM"), day ("Tue") or date ("Nov 20"). Newest chat first. The open chat's row has a filled background.
- [ ] A chat's row shows a spinner while Doc works on it, and an amber dot while a save waits for the partner's OK.
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
- [ ] An empty chat shows one line in the middle of the page, "What do you need?", with the typing box under it. The box's placeholder reads "Ask about a deal, a lead, a client or your mail". After the first question the box moves to the bottom.
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

- [ ] **Send**, **New chat** and **Recent chats** are icons. Each keeps its name for screen readers and on hover.

## Ask a question

- [ ] Sending shows the question once and a line where the answer will land with a spinner and "Doc is working · 12s", counting seconds. While a question is queued or working, the next question waits in the typing box until the partner can send it.
- [ ] The reply is text with source chips for the exact records used. When more than one record could match, Doc asks which one and shows match chips for the records the partner can open. When a record is unavailable, Doc says so without showing facts from it.
- [ ] On a question about mail, Doc can list the partner's pending mail priorities and answer from the exact message in a review. The source opens the existing Home review. Mail without verified membership in the partner's mailbox is unavailable.
- [ ] A queued question stays visible. Where the answer will land, a still grey dot and one sentence say why it waits. Before setup, "Doc isn't set up on your Mac yet." While the Mac is offline, "Doc answers when your Mac is on." If Claude Code needs a fresh sign-in, "Sign in to Claude Code on your Mac." If the plan limit is reached, "Doc is paused until your Claude plan resets." While a ready Mac has work ahead of this question, "Doc is waiting for a free slot on your Mac." When the backup is also unavailable, Doc answers when the Mac can run it.
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

## Kept from our rules

- [ ] **Send** is neutral. The save button is the one orange button in view.
- [ ] No model picker, microphone, right-hand panel, search over chats, or rows that list Doc's steps.
- [ ] Tones, type sizes and spacing come from the app's tokens. A chat uses three text sizes, and a new chat four. See [design principles](../design-principles.md).

## Coming later

These need new engine work first and are not current behavior.

- **Attach a file.** The paperclip will attach a PDF or photo for Doc to read, shown as a chip in the typing box with an x to remove it. It needs a design in `docs/new-database.md` first.
- **Stop.** A square button will take the place of **Send** while Doc works and cancel that question.

The engine owns the [conversation and turn contract](../new-database.md#doc-conversations-and-turns). Mail jobs that need judgment use the partner's link after any waiting chat turns and stay out of the chats list. Verify these lines as both partners, including a mailbox the other partner cannot open.
