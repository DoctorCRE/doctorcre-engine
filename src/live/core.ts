export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_REPLAY_NOTICES = 2_000;
export const MERGE_WINDOW_MS = 1_000;

export type SocketTag =
	| "tab"
	| "mac"
	| "job"
	| `${"user" | "session" | "link" | "job"}:${string}`;

export type Audience =
	| { readonly kind: "tabs" }
	| { readonly kind: "user_tabs"; readonly userId: string }
	| { readonly kind: "user_mac"; readonly userId: string }
	| { readonly kind: "job"; readonly slug: string };

type Body = {
	readonly topic: string;
	readonly id: string;
	readonly version: number | null;
};
export type NoticeInput = Body & { readonly audience: Audience };
export type Notice = Body & { readonly seq: number };
type StoredNotice = Notice & {
	readonly audience: Audience;
	readonly emittedAt: number;
};
type PendingNotice = NoticeInput & {
	readonly flushAt: number;
};
export type ServerMessage =
	| {
			readonly type: "hello" | "reset";
			readonly epoch: string;
			readonly seq: number;
	  }
	| ({ readonly type: "notice" } & Notice);

type WorkDue = (
	| { readonly kind: "backup" | "credit_retry"; readonly userId: string }
	| {
			readonly kind: "claim_expiry";
			readonly userId: string;
			readonly workId: string;
	  }
) & { readonly key: string; readonly dueAt: number };

export type DueEntry =
	| { readonly key: "flush"; readonly kind: "flush"; readonly dueAt: number }
	| {
			readonly key: "day";
			readonly kind: "day";
			readonly dueAt: number;
			readonly day: string;
	  }
	| WorkDue;

export type ChannelState = {
	epoch: string;
	seq: number;
	evictedSeq: number;
	notices: StoredNotice[];
	lastSent: Record<string, number>;
	pending: Record<string, PendingNotice>;
	due: Record<string, DueEntry>;
};
export interface LiveSocket {
	send(message: string): void;
}
export interface SocketHub {
	getWebSockets(tag?: SocketTag): readonly LiveSocket[];
	getTags(socket: LiveSocket): readonly string[];
}

export const createChannelState = (epoch: string): ChannelState => ({
	epoch,
	seq: 0,
	evictedSeq: 0,
	notices: [],
	lastSent: {},
	pending: {},
	due: {},
});
export const tabTags = (userId: string, session: string): SocketTag[] => [
	"tab",
	`user:${userId}`,
	`session:${session}`,
];
export const macTags = (userId: string, linkId: string): SocketTag[] => [
	"mac",
	`user:${userId}`,
	`link:${linkId}`,
];
export const jobTags = (slug: string): SocketTag[] => ["job", `job:${slug}`];

function audienceTags(
	a: Audience,
): readonly [SocketTag] | readonly [SocketTag, SocketTag] {
	if (a.kind === "tabs") return ["tab"];
	if (a.kind === "job") return [`job:${a.slug}`];
	return [a.kind === "user_tabs" ? "tab" : "mac", `user:${a.userId}`];
}

const matchesAudience = (tags: readonly string[], a: Audience) =>
	audienceTags(a).every((tag) => tags.includes(tag));

function routeSockets(hub: SocketHub, a: Audience) {
	const [first, last] = audienceTags(a);
	return last
		? hub.getWebSockets(last).filter((ws) => hub.getTags(ws).includes(first))
		: hub.getWebSockets(first);
}

export function parseCursor(raw: string) {
	const split = raw.lastIndexOf(":");
	const seqText = split > 0 ? raw.slice(split + 1) : "";
	if (!/^\d+$/.test(seqText)) return null;
	const seq = Number(seqText);
	return Number.isSafeInteger(seq) ? { epoch: raw.slice(0, split), seq } : null;
}

const earliest = (times: Iterable<number>) => {
	let min: number | null = null;
	for (const t of times) if (min === null || t < min) min = t;
	return min;
};
export const nextAlarmAt = (due: Readonly<Record<string, DueEntry>>) =>
	earliest(Object.values(due).map((e) => e.dueAt));

export function scheduleDue(state: ChannelState, entry: DueEntry) {
	state.due[entry.key] = entry;
	return nextAlarmAt(state.due);
}

const mergeKeyFor = (n: NoticeInput) =>
	`${audienceTags(n.audience).join(",")}\0${n.topic}\0${n.id}`;
const mergeVersion = (a: number | null, b: number | null) =>
	a !== null && b !== null ? Math.max(a, b) : (b ?? a);

function safeSend(socket: LiveSocket, msg: ServerMessage): boolean {
	try {
		socket.send(JSON.stringify(msg));
		return true;
	} catch {
		return false;
	}
}

function pruneHistory(state: ChannelState, now: number): void {
	const cutoff = now - REPLAY_WINDOW_MS;
	const fresh = state.notices.findIndex((n) => n.emittedAt >= cutoff);
	const aged = fresh === -1 ? state.notices.length : fresh;
	const drop =
		aged + Math.max(0, state.notices.length - aged - MAX_REPLAY_NOTICES);
	const last = drop > 0 ? state.notices[drop - 1] : undefined;
	if (!last) return;
	state.notices.splice(0, drop);
	state.evictedSeq = Math.max(state.evictedSeq, last.seq);
}

function pruneLastSent(state: ChannelState, now: number): void {
	const cutoff = now - MERGE_WINDOW_MS;
	for (const key in state.lastSent) {
		if ((state.lastSent[key] ?? 0) <= cutoff) delete state.lastSent[key];
	}
}

function syncFlushDue(state: ChannelState): void {
	const dueAt = earliest(Object.values(state.pending).map((p) => p.flushAt));
	if (dueAt === null) delete state.due.flush;
	else state.due.flush = { key: "flush", kind: "flush", dueAt };
}

function emit(
	state: ChannelState,
	hub: SocketHub,
	input: NoticeInput,
	now: number,
): Notice {
	state.seq += 1;
	const notice: Notice = {
		seq: state.seq,
		topic: input.topic,
		id: input.id,
		version: input.version,
	};
	state.notices.push({ ...notice, audience: input.audience, emittedAt: now });
	pruneHistory(state, now);
	const frame: ServerMessage = { type: "notice", ...notice };
	for (const ws of routeSockets(hub, input.audience)) safeSend(ws, frame);
	return notice;
}

function sendTracked(
	state: ChannelState,
	hub: SocketHub,
	key: string,
	input: NoticeInput,
	now: number,
): Notice {
	delete state.pending[key];
	state.lastSent[key] = now;
	return emit(state, hub, input, now);
}

export function connectSocket(
	state: ChannelState,
	hub: SocketHub,
	socket: LiveSocket,
	now: number,
	after?: string | null,
) {
	pruneHistory(state, now);
	const { epoch, seq } = state;
	if (after === undefined || after === null) {
		safeSend(socket, { type: "hello", epoch, seq });
		return { epoch, seq };
	}
	const cursor = parseCursor(after);
	if (
		!cursor ||
		cursor.epoch !== epoch ||
		cursor.seq < state.evictedSeq ||
		cursor.seq > seq
	) {
		safeSend(socket, { type: "reset", epoch, seq });
		return { epoch, seq };
	}
	const tags = hub.getTags(socket);
	const latest = new Map<string, Notice>();
	for (const n of state.notices) {
		if (n.seq <= cursor.seq || !matchesAudience(tags, n.audience)) continue;
		const key = `${n.topic}\0${n.id}`;
		const version = mergeVersion(latest.get(key)?.version ?? null, n.version);
		latest.set(key, { seq: n.seq, topic: n.topic, id: n.id, version });
	}
	for (const notice of [...latest.values()].sort((a, b) => a.seq - b.seq)) {
		if (!safeSend(socket, { type: "notice", ...notice })) return { epoch, seq };
	}
	safeSend(socket, { type: "hello", epoch, seq });
	return { epoch, seq };
}

export function publishNotices(
	state: ChannelState,
	hub: SocketHub,
	notices: readonly NoticeInput[],
	now: number,
) {
	const sent: Notice[] = [];
	if (notices.length === 0) return { sent, nextAlarm: nextAlarmAt(state.due) };
	pruneLastSent(state, now);
	const batch = new Map<string, NoticeInput>();
	for (const n of notices) {
		const key = mergeKeyFor(n);
		batch.set(key, {
			...n,
			version: mergeVersion(batch.get(key)?.version ?? null, n.version),
		});
	}
	for (const [key, n] of batch) {
		const lastAt = state.lastSent[key];
		const version = mergeVersion(
			state.pending[key]?.version ?? null,
			n.version,
		);
		if (lastAt !== undefined && now < lastAt + MERGE_WINDOW_MS) {
			state.pending[key] = { ...n, version, flushAt: lastAt + MERGE_WINDOW_MS };
		} else {
			sent.push(sendTracked(state, hub, key, { ...n, version }, now));
		}
	}
	syncFlushDue(state);
	return { sent, nextAlarm: nextAlarmAt(state.due) };
}

export function runAlarm(state: ChannelState, hub: SocketHub, now: number) {
	pruneLastSent(state, now);
	const dueNow = Object.values(state.due).filter((e) => e.dueAt <= now);
	for (const e of dueNow) delete state.due[e.key];
	const dueItems: WorkDue[] = [];
	const flushed: Notice[] = [];
	for (const e of dueNow) {
		if (e.kind === "flush") {
			for (const [key, p] of Object.entries(state.pending)) {
				if (p.flushAt <= now)
					flushed.push(sendTracked(state, hub, key, p, now));
			}
			syncFlushDue(state);
		} else if (e.kind === "day") {
			const day: NoticeInput = {
				topic: "day",
				id: e.day,
				version: null,
				audience: { kind: "tabs" },
			};
			flushed.push(emit(state, hub, day, now));
		} else dueItems.push(e);
	}
	return { dueItems, flushed, nextAlarm: nextAlarmAt(state.due) };
}
