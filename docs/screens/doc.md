# Doc

- **For** each signed-in partner, on a computer or phone.
- **Must** answer questions about deals, leads, clients, and the partner's own mail. Keep each partner's conversations private.
- **Must** wait for the partner to confirm a note, next step, or pending reply draft. Sending a reply stays in the existing review.

- [ ] **Doc link** in account settings shows the signed-in partner's Mac status. It uses the queued-question wording for setup, offline, sign-in and plan limits. A ready Mac shows "Doc is ready on your Mac." The partner can make, replace or revoke their own link code. Each new code appears once.

## Open a conversation

- [ ] **Ask Doc** in the app shell opens `/doc-chats`. The search orb still searches. Any partner-facing instruction to ask Doc points to this chat. The chat shows only questions, answers, and proposals for the signed-in partner.
- [ ] The page opens with a place to type, **Send**, **New chat**, and **Recent chats**. A partner with an empty list sees "No conversations yet" and can send a first question. **New chat** clears the composer and starts an empty chat. The first send creates the conversation.
- [ ] Recent chats show the start of each first question, newest chat first. Select a chat to reopen its saved questions and answers in order. **Show older chats** loads the next page when there is one. Reloading an open chat brings back the saved conversation. Switching partners clears the previous partner's chat from the screen.
- [ ] While recent chats or an open chat loads, the page says it is loading. If the read fails, it says the chats could not be loaded and offers **Retry**. An old `/doc-chats?id=…` or exact-turn link that refers to an old conversation says "This older conversation wasn't kept" and offers **New chat**. An unknown new link says "Conversation unavailable".
- [ ] At phone width, **Recent chats** opens the list within the page. Choosing a chat returns to the conversation. The question, source links, proposal editor, and buttons fit without sideways scrolling.

## Ask a question

- [ ] **Send** is available for a nonblank question up to 4,000 characters. Sending shows the question once and says "Doc is working" while it runs. While a question is queued or working, another question stays in the composer until the partner can send it.
- [ ] The reply is text with links that open the exact deal, lead, client, or mail review used. When more than one record could match, Doc asks the partner which one they mean and links the matches they can open. When a record is unavailable, Doc says so without showing facts from it.
- [ ] On a question about mail, Doc can list the partner's pending mail priorities and answer from the exact message in a review. The source opens the existing Home review. Mail without verified membership in the partner's mailbox is unavailable.
- [ ] A queued question stays visible. Before setup, show "Doc isn't set up on your Mac yet." A backup answer shows a small note: "Answered by the backup." When the backup is also unavailable, Doc answers when the Mac can run it. While the Mac is offline, show "Doc answers when your Mac is on." If Claude Code needs a fresh sign-in, show "Sign in to Claude Code on your Mac." If the plan limit is reached, show "Doc is paused until your Claude plan resets." While a ready Mac has work ahead of this question, show "Doc is waiting for a free slot on your Mac."
- [ ] If an answer fails, the question stays visible with **Retry**. **Retry** on the latest failed question uses the same question and fills in its answer once. If the reply draft has a newer revision or has left pending, retry returns a conflict and the partner needs a fresh review. Reopening a chat shows a saved question and its current state. A signed-out tab asks the partner to sign in again.
- [ ] An unsupported action gets a plain explanation and makes no business change. Mail content cannot authorize a save or access to another mailbox.

## Confirm a save

- [ ] A proposal shows the exact record or email, the proposed text, and one save button. The partner can edit the note or next-step text, the next-step date, or the reply subject and body before saving. An unanswered or ambiguous choice shows no save button.
- [ ] **Save note** adds the note to that record. **Save next step** adds the partner's own step. A note or step shows as saved with a link to the record once the save returns. If the partner already has an open step there, Doc links to the record to edit it.
- [ ] **Save draft and open review** opens the existing reply review for that draft. A draft already on the email, or a pending draft in its Outlook conversation, opens with its saved text. The partner reviews and submits mail in that review.
- [ ] **Talk to Doc about this draft** in reply review opens Doc with the exact pending draft and its source email. Doc can propose a revised subject, body, or both. Edit the proposed text and choose **Save revision** to update that draft and return to its review. A newer revision or a draft that has left pending needs a fresh review. **Send reply** stays in reply review.
- [ ] If a save fails, the edit stays visible and the message says what happened. A lost response offers **Retry** for the same save. A target or step that changed asks the partner to open the record or ask Doc again. Reloading after success shows the saved result once.

The engine owns the [conversation and turn contract](../new-database.md#doc-conversations-and-turns). Mail jobs that need judgment use the partner's link after any waiting chat turns and stay out of Recent chats. Verify these lines on a signed-in app against the practice copy as both partners, including a mailbox the other partner cannot open.
