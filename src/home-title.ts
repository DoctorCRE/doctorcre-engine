const decisionPrefix = /^(?:[A-Z][A-Z'.-]* )+DECIDE\s*:\s*/;
const statusPrefix =
	/^(?:(?:NONE|HOLD)(?:\s*[—–:-]\s*|$)|review(?: follow-up| call note)?\s*:\s*)/i;
const sentenceBoundary = /(?<!\b(?:[A-Z]|Dr|Mr|Mrs|Ms|St|Inc)\.)(?<=[.!?])\s+/i;
const actionStart =
	/^(?:please )?(?:(?:follow up|reach out)\b|(?:follow-up|add|approve|arrange|ask|book|call|check|choose|collect|compare|complete|confirm|contact|coordinate|decide|discuss|draft|email|file|find|get|introduce|look|meet|move|negotiate|obtain|prepare|refer|relocate|renew|reply|request|respond|review|schedule|send|share|sign|submit|update|verify|visit|wait) \S)/i;
const savedLabel =
	/^(?:email from|call (?:from|with)|follow[- ]up (?:set|due|completed|scheduled|held|done))\b/i;
const titleCharacters = new Intl.Segmenter("en", { granularity: "grapheme" });

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

export function homeSentences(text: string, limit?: number) {
	return text.split(sentenceBoundary, limit);
}

export function isHomeAction(text: string) {
	return actionStart.test(text) && !savedLabel.test(text);
}

function fitsTitle(text: string) {
	if (!text || /…|\.\.\./.test(text)) return false;
	let remaining = 90;
	for (const _ of titleCharacters.segment(text)) {
		if (--remaining < 0) return false;
	}
	return true;
}

export function homeTitle(fallback: string, ...candidates: string[]) {
	return candidates.find(fitsTitle) ?? fallback;
}

export function homeActionTitle(
	action: string,
	target: string,
	fallback: string,
) {
	if (!isHomeAction(action)) return fallback;
	const [first = ""] = homeSentences(action, 1);
	const shorter = isHomeAction(first) ? first : "";
	const withTarget = (text: string) =>
		text && target && !text.toLowerCase().includes(target.toLowerCase())
			? `${text.replace(/\.$/, "")} (${target})`
			: text;
	return homeTitle(
		fallback,
		withTarget(action),
		withTarget(shorter),
		action,
		shorter,
	);
}
