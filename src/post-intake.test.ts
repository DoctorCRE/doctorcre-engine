import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";
import { intake } from "./post-intake.ts";
import app from "./worker.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = id(1);
const LINKEDIN = id(2);
const INSTAGRAM = id(3);
const FACEBOOK = id(4);
// An email attachment, which intake never checked.
const UNTYPED = id(5);
// Monday 12/21 at midnight in Central time.
const ENGINE_FROM = "2026-12-21T06:00:00+00:00";
const WEEK = "2026-12-28";

// The Workers runtime's stream that holds a body to its length.
Object.assign(globalThis, {
	FixedLengthStream: class extends TransformStream {
		constructor(_length: number) {
			super();
		}
	},
});

const url = process.env.TEST_DATABASE_URL;
if (!url)
	throw new Error("Run npm run check to restore the test database first");
const name = `engine_intake_${randomUUID().replaceAll("-", "")}`;
const target = new URL(url);
target.pathname = `/${name}`;

before(async () => {
	await asAdmin(`create database "${name}" template template0`);
	const owner = new pg.Client({ connectionString: target.href });
	await owner.connect();
	await owner.query(`create schema next; set search_path = next;
		${await readFile(new URL("../schema/next.sql", import.meta.url), "utf8")}
		select set_config('engine.user_id', '${USER}', false);
		insert into party (id, kind, name) values ('${USER}', 'person', 'Jordan Example');
		insert into app_user (id, slug) values ('${USER}', 'user-${USER}');
		insert into social_account (id, platform, owner_party_id, handle, engine_publishes_from) values
			('${LINKEDIN}', 'linkedin', '${USER}', 'jordan-example', '${ENGINE_FROM}'),
			('${INSTAGRAM}', 'instagram', '${USER}', 'jordan.example', '${ENGINE_FROM}'),
			('${FACEBOOK}', 'facebook', '${USER}', 'jordan-example-page', null);
		insert into document (id, name, r2_key) values ('${UNTYPED}', 'Example attachment.pdf', 'example/attachment.pdf');`);
	await owner.end();
	target.searchParams.set("options", "-c search_path=next -c role=engine");
});

after(async () => {
	await asAdmin(`drop database "${name}" with (force)`);
});

const stored = new Map<string, string>();
const env = () => ({
	NEXT_DATABASE: { connectionString: target.href },
	POST_MEDIA: {
		async put(
			key: string,
			file: ReadableStream<Uint8Array>,
			options: { httpMetadata: { contentType: string } },
		) {
			await new Response(file).arrayBuffer();
			stored.set(key, options.httpMetadata.contentType);
			return {};
		},
		async delete(key: string) {
			stored.delete(key);
		},
	},
});

const jpeg = new Uint8Array(1000);
jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
jpeg.set([0xff, 0xc0, 0, 17, 8, 0x05, 0x46, 0x04, 0x38, 3], 20);

const upload = (
	file: Uint8Array,
	length = file.length,
	query = "?name=x",
	bindings: object = env(),
) =>
	intake.request(
		`/media${query}`,
		{
			method: "POST",
			body: file,
			headers: { "content-length": String(length) },
		},
		bindings,
	);
const uploaded = async () =>
	((await (await upload(jpeg)).json()) as { document_id: string }).document_id;

const create = (post: Record<string, unknown>) =>
	intake.request(
		"/posts",
		{ method: "POST", body: JSON.stringify(post) },
		env(),
	);
const photoPost = (n: number, media: string[], fields = {}) => ({
	id: id(n),
	social_account_id: LINKEDIN,
	format: "photo",
	scheduled_at: "2026-12-29T15:00:00Z",
	text: "Five example lease questions",
	media,
	...fields,
});
const read = (path: string) => intake.request(path, {}, env());
const refusal = async (answer: Response) => [
	answer.status,
	((await answer.json()) as { error: string }).error,
];

const documents = async () => {
	const db = new pg.Client({ connectionString: target.href });
	await db.connect();
	const { rows } = await db.query(
		"select id, name, r2_key, content_type from document order by name",
	);
	await db.end();
	return rows;
};

test("a file is stored under a new document id and recorded with its type", async () => {
	const answer = await upload(jpeg, jpeg.length, "?name=Example%20card.jpg");
	assert.equal(answer.status, 201);
	const { document_id, content_type } = (await answer.json()) as {
		document_id: string;
		content_type: string;
	};
	assert.equal(content_type, "image/jpeg");
	assert.equal(stored.get(document_id), "image/jpeg");
	const rows = await documents();
	assert.deepEqual(
		rows.filter((row) => row.id === document_id),
		[
			{
				id: document_id,
				name: "Example card.jpg",
				r2_key: document_id,
				content_type: "image/jpeg",
			},
		],
	);
});

test("a post goes in with its text and picture, and reads back alone and in its week", async () => {
	const upload1 = await upload(jpeg);
	assert.equal(upload1.status, 201);
	const { document_id, content_type } = (await upload1.json()) as {
		document_id: string;
		content_type: string;
	};
	assert.equal(content_type, "image/jpeg");
	assert.equal(stored.get(document_id), "image/jpeg");
	const expected = {
		id: id(10),
		social_account_id: LINKEDIN,
		platform: "linkedin",
		format: "photo",
		scheduled_at: "2026-12-29T15:00:00+00:00",
		status: "scheduled",
		reason: null,
		platform_post_id: null,
		published_at: null,
		text: { version: 1, body: "Five example lease questions" },
		media: [{ position: 1, document_id, content_type: "image/jpeg" }],
	};
	const created = await create(photoPost(10, [document_id]));
	assert.equal(created.status, 201);
	assert.deepEqual(await created.json(), expected);
	assert.deepEqual(await (await read(`/posts/${id(10)}`)).json(), expected);
	const user = new pg.Client({ connectionString: target.href });
	await user.connect();
	const { rows: authors } = await user.query(
		`select changed_by_job, changed_by_user_id, changed_for_user_id from post where id = $1
		union select changed_by_job, changed_by_user_id, changed_for_user_id from post_text where post_id = $1
		union select changed_by_job, changed_by_user_id, changed_for_user_id from post_media where post_id = $1
		union select changed_by_job, changed_by_user_id, changed_for_user_id from document where id = $2`,
		[id(10), document_id],
	);
	assert.deepEqual(authors, [
		{
			changed_by_job: "intake",
			changed_by_user_id: null,
			changed_for_user_id: null,
		},
	]);
	await user.query("select set_config('engine.user_id', $1, false)", [USER]);
	await user.query(
		"insert into post_text (post_id, version, body) values ($1, 2, 'Six example lease questions')",
		[id(10)],
	);
	await user.end();
	assert.deepEqual(await (await read(`/posts/${id(10)}`)).json(), {
		...expected,
		text: { version: 2, body: "Six example lease questions" },
	});

	// Central time's Sunday night and the next Monday fall outside the week.
	for (const [n, scheduled_at] of [
		[11, "2026-12-28T05:59:00Z"],
		[12, "2026-12-28T06:00:00Z"],
		[13, "2027-01-04T05:59:00Z"],
		[14, "2027-01-04T06:00:00Z"],
	] as const)
		await create({ ...photoPost(n, []), format: "text", scheduled_at });
	const week = (await (await read(`/posts?week=${WEEK}`)).json()) as {
		posts: { id: string }[];
	};
	assert.deepEqual(
		week.posts.map((post) => post.id),
		[id(12), id(10), id(13)],
	);
	assert.deepEqual(await refusal(await read(`/posts/${id(99)}`)), [
		404,
		"not_found",
	]);
	// 2027-02-29 does not exist; JavaScript alone would read it as Monday 3/1.
	for (const day of ["2026-12-29", "2027-02-29"])
		assert.deepEqual(await refusal(await read(`/posts?week=${day}`)), [
			400,
			"invalid_week",
		]);
});

test("a week across a clock change runs from midnight to midnight in Central time", async () => {
	// Clocks go forward on Sunday 3/14, so the week ends at 05:00 UTC, not 06:00.
	for (const [n, scheduled_at] of [
		[50, "2027-03-08T05:59:00Z"],
		[51, "2027-03-08T06:00:00Z"],
		[52, "2027-03-15T04:59:00Z"],
		[53, "2027-03-15T05:00:00Z"],
	] as const) {
		const post = { ...photoPost(n, []), format: "text", scheduled_at };
		assert.equal((await create(post)).status, 201);
	}
	const week = (await (await read("/posts?week=2027-03-08")).json()) as {
		posts: { id: string }[];
	};
	assert.deepEqual(
		week.posts.map((post) => post.id),
		[id(51), id(52)],
	);
});

test("a post timed before its account's engine_publishes_from is refused, and nothing is kept", async () => {
	for (const [n, fields] of [
		[20, { scheduled_at: "2026-12-21T05:59:00Z" }],
		[21, { social_account_id: FACEBOOK }],
	] as const) {
		const post = photoPost(n, [await uploaded()], fields);
		assert.deepEqual(await refusal(await create(post)), [
			422,
			"before_engine_publishes_from",
		]);
		assert.equal((await read(`/posts/${id(n)}`)).status, 404);
	}
	const ready = await create(
		photoPost(22, [await uploaded()], { scheduled_at: ENGINE_FROM }),
	);
	assert.equal(ready.status, 201);
});

test("a post whose format or files do not fit is refused, and nothing is kept", async () => {
	const photo = await uploaded();
	for (const [n, fields, refused] of [
		[30, { format: "video" }, [422, "media_type_does_not_fit_format"]],
		[31, { media: [photo, photo] }, [422, "media_do_not_fit_format"]],
		[
			32,
			{ social_account_id: INSTAGRAM, format: "text", media: [] },
			[422, "format_not_offered"],
		],
		[33, { media: [id(99)] }, [422, "unknown_document"]],
		[34, { social_account_id: id(99) }, [422, "unknown_account"]],
		[35, { text: " " }, [422, "blank_text"]],
		[36, { media: [] }, [400, "invalid_post"]],
		[37, { format: "text" }, [400, "invalid_post"]],
		[38, { scheduled_at: "2026-12-29T15:00:00" }, [400, "invalid_post"]],
		[39, { alt_text: "Example" }, [400, "invalid_post"]],
		[41, { scheduled_at: "2027-02-30T15:00:00Z" }, [400, "invalid_post"]],
		[42, { media: [UNTYPED] }, [422, "unknown_document"]],
	] as const) {
		const post = photoPost(n, [photo], fields);
		assert.deepEqual(await refusal(await create(post)), refused);
		assert.equal((await read(`/posts/${id(n)}`)).status, 404);
	}
	assert.equal((await create(photoPost(40, [photo]))).status, 201);
	assert.deepEqual(await refusal(await create(photoPost(40, [photo]))), [
		409,
		"post_exists",
	]);
});

test("a file of the wrong type or size, or one the database cannot record, is refused, and nothing is stored", async () => {
	const [files, rows] = [stored.size, (await documents()).length];
	for (const [answer, refused] of [
		[
			upload(new TextEncoder().encode("an example caption")),
			[422, "unsupported_file"],
		],
		[upload(jpeg, 8_000_001), [422, "too_large"]],
		[upload(jpeg, 0), [411, "length_required"]],
		[upload(jpeg, jpeg.length, ""), [400, "name_required"]],
		[
			upload(jpeg, jpeg.length, "?name=x", { POST_MEDIA: env().POST_MEDIA }),
			[503, "database_unavailable"],
		],
	] as const)
		assert.deepEqual(await refusal(await answer), refused);
	assert.equal(stored.size, files);
	assert.equal((await documents()).length, rows);
});

test("a file whose row cannot be written is removed again", async () => {
	const files = stored.size;
	const readOnly = new URL(target.href);
	readOnly.searchParams.set(
		"options",
		`${readOnly.searchParams.get("options")} -c default_transaction_read_only=on`,
	);
	const answer = await upload(jpeg, jpeg.length, "?name=x", {
		...env(),
		NEXT_DATABASE: { connectionString: readOnly.href },
	});
	assert.equal(answer.status, 500);
	assert.equal(stored.size, files);
});

test("intake answers only through its own Access application", async () => {
	const ask = (bindings: object) =>
		app.request(
			"/intake/media?name=x",
			{ method: "POST", body: jpeg },
			{ ...env(), ...bindings },
		);
	assert.deepEqual(await refusal(await ask({})), [503, "intake_unconfigured"]);
	const team = "https://example.cloudflareaccess.com";
	assert.deepEqual(
		await refusal(
			await ask({ ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: "made-up-compare" }),
		),
		[503, "intake_unconfigured"],
	);
	assert.deepEqual(
		await refusal(
			await ask({ ACCESS_TEAM_DOMAIN: team, INTAKE_ACCESS_AUD: "made-up" }),
		),
		[401, "unauthorized"],
	);
});
