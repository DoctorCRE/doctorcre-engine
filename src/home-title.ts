const decisionPrefix = /^(?:[A-Z][A-Z'.-]* )+DECIDE\s*:\s*/;
const statusPrefix =
	/^(?:(?:NONE|HOLD)(?:\s*[—–:-]\s*|$)|review(?: follow-up| call note)?\s*:\s*)/i;
const titleCharacters = new Intl.Segmenter("en", { granularity: "grapheme" });
const titleWords = new Intl.Segmenter("en", { granularity: "word" });

const chooseDeal = (sender: string) =>
	sender
		? `Choose the deal for ${sender}'s email`
		: "Choose the deal for this email";
const reviewLead = (target: string) =>
	target ? `Review adding ${target} as a lead` : "Review the possible lead";
const forTarget = (action: string, target: string) =>
	target ? `${action} for ${target}` : action;
const replyTarget = (sender: string, deal: string) =>
	`${sender ? ` to ${sender}` : ""}${deal ? ` about ${deal}` : ""}`;

const templates = {
	follow_up: (target) =>
		target ? `Follow up on ${target}` : "Review the follow-up",
	call_follow_up: (contact) =>
		contact ? `Follow up with ${contact}` : "Review the call follow-up",
	vendor_check_in: (vendor) => `Check in with ${vendor || "the vendor"}`,
	next_step: (target) => forTarget("Review the proposed follow-up", target),
	file_to_deal: chooseDeal,
	possible_new_deal: chooseDeal,
	phase_move: (target, phase) =>
		target && phase
			? `Review moving ${target} to ${phase}`
			: forTarget("Review the proposed phase change", target),
	new_lead: reviewLead,
	email_lead: reviewLead,
	lead_stage_move: (target, stage) =>
		target && stage
			? `Review moving ${target} to ${stage}`
			: forTarget("Review the proposed lead stage", target),
	log_call: (target) => forTarget("Review the call note", target),
	next_step_done: (deal) =>
		deal
			? `Check whether the step for ${deal} is done`
			: "Check whether the step is done",
	checklist: (deal) => forTarget("Review the checklist item", deal),
	tour_feedback: (deal, property) =>
		property
			? `Review tour feedback on ${property}${deal ? ` for ${deal}` : ""}`
			: forTarget("Review tour feedback", deal),
	reply_pending: (sender, deal) =>
		`Review the reply${replyTarget(sender, deal)}`,
	reply_failed: (sender) =>
		sender ? `Review reply delivery to ${sender}` : "Review reply delivery",
	reply_approved: (sender, deal) =>
		`Reply${replyTarget(sender, deal)} is sending`,
	reply_sent: (sender, deal) => `Reply${replyTarget(sender, deal)} was sent`,
} satisfies Record<string, (target: string, detail: string) => string>;

export function stripHomeTitlePrefixes(text: string) {
	let remaining = text;
	while (true) {
		const stripped = remaining
			.replace(statusPrefix, "")
			.replace(decisionPrefix, "");
		if (stripped === remaining) return remaining;
		remaining = stripped;
	}
}

function titleLimitIndex(text: string) {
	let remaining = 90;
	for (const { index } of titleCharacters.segment(text)) {
		if (--remaining < 0) return index;
	}
	return text.length;
}

function fitsLength(text: string) {
	return text.length > 0 && titleLimitIndex(text) === text.length;
}

export function shortenHomeTitle(text: string) {
	const limit = titleLimitIndex(text);
	if (limit === text.length) return text;
	const segment = titleWords.segment(text).containing(limit);
	return text.slice(0, segment?.index || limit).trimEnd();
}

function fitsTitle(text: string) {
	return (
		!/…|\.\.\.|\bemail (?:received )?from\b/i.test(text) && fitsLength(text)
	);
}

export function homeTitle(
	kind: keyof typeof templates,
	target = "",
	detail = "",
) {
	const render = templates[kind];
	const title = render(target, detail);
	if (fitsTitle(title)) return title;
	if (detail) {
		const shorter = render(target, "");
		if (fitsTitle(shorter)) return shorter;
	}
	return render("", "");
}

export function savedHomeTitle(text: string) {
	return fitsLength(text) ? text : "";
}
