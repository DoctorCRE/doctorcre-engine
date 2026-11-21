import { type Expression, sql } from "kysely";
import { homeDisplayText, homeStepText } from "./home-steps.ts";
import { homeTitle, savedHomeTitle } from "./home-title.ts";
import type { JsonObject } from "./next-database.d.ts";

// LIMIT keeps the summary lookup tied to the source email in the query plan.
export const currentEmailSummary = (activityId: Expression<string | null>) =>
	sql<{ text: string; provenance: JsonObject }>`
		select text, provenance from email_current_summary where activity_id = ${activityId} limit 1
	`;

export const savedEmailAction = sql<string | null>`
	case when jsonb_typeof(summary.provenance->'action_title') = 'string'
		then summary.provenance->>'action_title' end`;

export function savedEmailTitle(action: string | null) {
	return savedHomeTitle(homeStepText(action ?? ""));
}

type EmailSuggestionKind =
	| "next_step"
	| "file_to_deal"
	| "possible_new_deal"
	| "phase_move"
	| "new_lead"
	| "email_lead"
	| "lead_stage_move"
	| "log_call";

export function emailSuggestionTitle({
	kind,
	email_action_title,
	email_sender,
	context_label,
	decision_label,
}: {
	kind: EmailSuggestionKind;
	email_action_title: string | null;
	email_sender: string | null;
	context_label: string | null;
	decision_label: string | null;
}) {
	const sender = homeDisplayText(email_sender);
	const target =
		kind === "file_to_deal" || kind === "possible_new_deal"
			? sender.includes("@")
				? ""
				: sender
			: homeDisplayText(context_label) || sender;
	return (
		savedEmailTitle(email_action_title) ||
		homeTitle(kind, target, homeDisplayText(decision_label))
	);
}
