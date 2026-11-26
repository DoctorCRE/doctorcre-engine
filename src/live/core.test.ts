import assert from "node:assert/strict";
import { test } from "node:test";
import * as live from "./core.ts";

class FakeSocket implements live.LiveSocket {
	readonly received: live.ServerMessage[] = [];
	failSend = false;
	send(raw: string) {
		if (this.failSend) throw new Error("closed");
		const msg: live.ServerMessage = JSON.parse(raw);
		this.received.push(msg);
	}
}

const tabs: live.Audience = { kind: "tabs" };
const msg = (
	topic: string,
	id: string,
	version: number | null,
	audience: live.Audience = tabs,
): live.NoticeInput => ({ topic, id, version, audience });

function harness(startMs = 1_700_000_000_000) {
	let clock = startMs;
	const state = live.createChannelState("ep-1");
	const reg = new Map<live.LiveSocket, readonly live.SocketTag[]>();
	const hub: live.SocketHub = {
		getWebSockets: (tag) =>
			[...reg.entries()]
				.filter(([, t]) => !tag || t.includes(tag))
				.map(([ws]) => ws),
		getTags: (ws) => reg.get(ws) ?? [],
	};
	const add = (tags: readonly live.SocketTag[]) => {
		const ws = new FakeSocket();
		reg.set(ws, tags);
		return ws;
	};
	return {
		state,
		add,
		advance: (ms: number) => (clock += ms),
		publish: (...list: live.NoticeInput[]) =>
			live.publishNotices(state, hub, list, clock),
		connect: (ws: live.LiveSocket, after?: string | null) =>
			live.connectSocket(state, hub, ws, clock, after),
		alarm: (target = state) => live.runAlarm(target, hub, clock),
	};
}

test("tag routing isolates tabs, per-user tabs, Macs, jobs and broken sockets", () => {
	const h = harness();
	const tabA = h.add(live.tabTags("u-a", "s-1"));
	h.add(live.tabTags("u-a", "s-2")).failSend = true;
	const tabB = h.add(live.tabTags("u-b", "s-3"));
	const macA = h.add(live.macTags("u-a", "l-1"));
	const outbox = h.add(live.jobTags("outlook-outbox"));

	h.publish(
		msg("deal", "d-1", 10),
		msg("doc_turn", "t-1", null, { kind: "user_tabs", userId: "u-a" }),
		msg("doc_work", "w-1", null, { kind: "user_mac", userId: "u-a" }),
		msg("reply_delivery", "r-1", 11, { kind: "job", slug: "outlook-outbox" }),
	);
	const topics = (ws: FakeSocket) =>
		ws.received.map((m) => (m.type === "notice" ? m.topic : m.type));
	assert.deepEqual(topics(tabA), ["deal", "doc_turn"]);
	assert.deepEqual(topics(tabB), ["deal"]);
	assert.deepEqual(topics(macA), ["doc_work"]);
	assert.deepEqual(topics(outbox), ["reply_delivery"]);
});

test("connect sends hello, replays deduplicated filtered notices, and resets on epoch or gap", () => {
	const h = harness();
	const tabA = h.add(live.tabTags("u-a", "s-1"));
	assert.equal(h.connect(tabA).kind, "hello");
	assert.deepEqual(tabA.received, [{ type: "hello", epoch: "ep-1", seq: 0 }]);

	h.publish(
		msg("deal", "d-1", 1),
		msg("home_mark", "m-b", 2, { kind: "user_tabs", userId: "u-b" }),
	);
	h.advance(live.MERGE_WINDOW_MS);
	h.publish(msg("lead", "l-1", 3), msg("deal", "d-1", 4));

	const ws = h.add(live.tabTags("u-a", "s-2"));
	const res = h.connect(ws, "ep-1:1");
	assert.deepEqual([res.kind, res.replayed], ["replay", 2]);
	assert.deepEqual(ws.received, [
		{ type: "notice", seq: 3, topic: "lead", id: "l-1", version: 3 },
		{ type: "notice", seq: 4, topic: "deal", id: "d-1", version: 4 },
		{ type: "hello", epoch: "ep-1", seq: 4 },
	]);
	for (const bad of ["ep-other:1", "ep-1:99", "bad", ":1", "ep-1:-1"]) {
		const s = h.add(live.tabTags("u-a", "s-bad"));
		assert.equal(h.connect(s, bad).kind, "reset", bad);
		assert.deepEqual(s.received, [{ type: "reset", epoch: "ep-1", seq: 4 }]);
	}
	assert.deepEqual(live.parseCursor("a:b:42"), { epoch: "a:b", seq: 42 });
});

test("24-hour and 2,000-notice limits prune history and reset only when evicted notices were missed", () => {
	const h = harness();
	const total = live.MAX_REPLAY_NOTICES + 5;
	for (let i = 1; i <= total; i++) h.publish(msg("deal", `d-${i}`, i));
	const tab = () => h.add(live.tabTags("u-a", "s"));
	assert.equal(h.connect(tab(), "ep-1:4").kind, "reset");
	const ok = h.connect(tab(), "ep-1:5");
	assert.deepEqual([ok.kind, ok.replayed], ["replay", live.MAX_REPLAY_NOTICES]);

	h.advance(live.REPLAY_WINDOW_MS + 1);
	assert.equal(h.connect(tab(), `ep-1:${total - 1}`).kind, "reset");
	const latest = h.connect(tab(), `ep-1:${total}`);
	assert.deepEqual([latest.kind, latest.replayed], ["replay", 0]);
});

test("once-a-second merge sends first notice at once and delivers the last notice at the flush", () => {
	const h = harness(10_000);
	const tab = h.add(live.tabTags("u-a", "s-1"));
	const first = h.publish(msg("doc_turn", "t-1", 1), msg("doc_turn", "t-1", 2));
	assert.deepEqual(
		[first.sent.length, first.sent[0]?.version, first.held, first.nextAlarm],
		[1, 2, 0, null],
	);

	h.advance(200);
	h.publish(msg("doc_turn", "t-1", 3));
	h.advance(300);
	const held = h.publish(msg("doc_turn", "t-1", 4));
	assert.deepEqual(
		[held.sent.length, held.held, held.nextAlarm, tab.received.length],
		[0, 1, 11_000, 1],
	);

	// Reload from JSON to prove the last notice survives eviction before the flush.
	const restored: live.ChannelState = JSON.parse(JSON.stringify(h.state));
	h.advance(500);
	const flushed = h.alarm(restored);
	assert.equal(flushed.nextAlarm, null);
	assert.deepEqual(flushed.flushed, [
		{ seq: 2, topic: "doc_turn", id: "t-1", version: 4 },
	]);
	assert.deepEqual(tab.received, [
		{ type: "notice", seq: 1, topic: "doc_turn", id: "t-1", version: 2 },
		{ type: "notice", seq: 2, topic: "doc_turn", id: "t-1", version: 4 },
	]);
});

test("due-time table picks the earliest alarm across flush, day and work items", () => {
	const h = harness(20_000);
	const tab = h.add(live.tabTags("u-a", "s-1"));
	const addDue = (e: live.DueEntry, mode?: "replace" | "earliest") =>
		live.scheduleDue(h.state, e, mode);
	const backup: live.DueEntry = {
		key: "backup:u-a",
		kind: "backup",
		userId: "u-a",
		dueAt: 25_000,
	};
	const retry: live.DueEntry = {
		key: "retry:u-a",
		kind: "credit_retry",
		userId: "u-a",
		dueAt: 26_000,
	};
	assert.equal(addDue(backup), 25_000);
	assert.equal(addDue({ ...backup, dueAt: 29_000 }, "earliest"), 25_000);
	assert.equal(addDue(retry), 25_000);
	assert.equal(
		addDue({
			key: "claim:w-1",
			kind: "claim_expiry",
			userId: "u-a",
			workId: "w-1",
			dueAt: 22_000,
		}),
		22_000,
	);
	assert.equal(
		addDue({ key: "day", kind: "day", day: "2026-11-26", dueAt: 30_000 }),
		22_000,
	);

	h.publish(msg("deal", "d-a", 1));
	h.advance(200);
	h.publish(msg("deal", "d-b", 1));
	h.advance(100);
	h.publish(msg("deal", "d-b", 2), msg("deal", "d-a", 2));
	assert.equal(live.nextAlarmAt(h.state.due), 21_000);

	h.advance(700);
	const f1 = h.alarm();
	assert.deepEqual(
		[f1.flushed.map((n) => [n.id, n.version]), f1.nextAlarm],
		[[["d-a", 2]], 21_200],
	);
	h.advance(200);
	const f2 = h.alarm();
	assert.deepEqual(
		[f2.flushed.map((n) => [n.id, n.version]), f2.nextAlarm],
		[[["d-b", 2]], 22_000],
	);
	assert.equal(live.cancelDue(h.state, "claim:w-1"), 25_000);

	h.advance(8_800);
	const final = h.alarm();
	assert.deepEqual(final.dueItems, [backup, retry]);
	assert.deepEqual(final.flushed, [
		{ seq: 5, topic: "day", id: "2026-11-26", version: null },
	]);
	assert.equal(final.nextAlarm, null);
	assert.equal(tab.received.at(-1)?.type, "notice");
});
