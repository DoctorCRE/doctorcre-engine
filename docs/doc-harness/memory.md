# What Doc remembers

Chat history stays private. Use its last 12 answered turns to understand a reference such as "that deal" and reread the current record. Authoritative dates, commitments, amounts, ownership and contacts stay with their records. Mail, prior answers and model guesses cannot create preferences. [Private storage](../new-database.md#private-storage)

## Preference rows

Each row has a typed preference key, a value validated for that key, the scope and an update time. The scope comes from the key's definition. A team key has one current value for the team. Both partners use it by default and there is no share request. A personal key has one current value per partner and only that partner can read or edit it. Only the relevant rows go into a claim. A missing row uses the approved playbook baseline. Choose the initial value vocabulary and who may edit the team row in [Q7](questions.md#q7-preference-values-and-team-edits).

| First key              | Scope    | Value and use                                                                                                                        |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Draft length           | Personal | A typed length choice. Apply when writing or revising a draft. The partner can ask for a different length for this turn.             |
| Deal comparison format | Team     | A typed layout choice for deal comparisons. Both partners get the same saved format. The engine still checks cited values and links. |

Website layout is another example of a team preference. Writing style, schedules and habits are examples of personal preferences. Their storage waits for an approved key and workflow.

## F9 Save or remove a preference

1. When the partner directly asks Doc to remember a named preference, validate its key and value and show the pending change and scope in Ask Doc. A one-time instruction applies to that turn. The pending change affects no current preference.
2. On confirmation, the engine rechecks the signed-in writer and stores the typed row. The next relevant claim gets that value. Both partners use a team value without per-person share approval.
3. Settings shows the team and personal values the partner can see. An authorized edit replaces that row. A delete removes that value and restores the playbook baseline on the next relevant claim. A missing, invalid or unauthorized edit does not change a row.
