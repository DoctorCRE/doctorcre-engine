const decisionPrefix = /^(?:[A-Z][A-Z'.-]* )+DECIDE\s*:\s*/;
const statusPrefix =
	/^(?:(?:NONE|HOLD)(?:\s*[—–:-]\s*|$)|review(?: follow-up| call note)?\s*:\s*)/i;
const titleCharacters = new Intl.Segmenter("en", { granularity: "grapheme" });

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

function titleLimitIndex(text: string, limit = 90) {
	let remaining = limit;
	for (const { index } of titleCharacters.segment(text)) {
		if (--remaining < 0) return index;
	}
	return text.length;
}

function fitsLength(text: string) {
	return text.length > 0 && titleLimitIndex(text) === text.length;
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

export function shortHomeTitle(text: string) {
	if (!text || fitsLength(text)) return text;
	const head = text.slice(0, titleLimitIndex(text, 89));
	const words = /^\s/.test(text.slice(head.length))
		? head
		: head.replace(/\s+\S*$/, "");
	return `${(words || head).replace(/[\s,;:.·–—-]+$/, "")}…`;
}
