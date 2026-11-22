import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";
import { copyTest, readSchema } from "./test-copy.ts";

const legacyRoles = [
	"carr_reader",
	"carr_writer",
	"carr_jobs",
	"carr_authority",
];
const appRoles = ["engine", "engine_reader"];
const readersAndWriters = ["carr_reader", "carr_writer"];
const readersWritersAndJobs = [...readersAndWriters, "carr_jobs"];
const functions = [
	["ops.engineering_admission_source(text)", readersWritersAndJobs],
	["ops.engineering_passport_facts(text)", readersWritersAndJobs],
	[
		"ops.hermes_runtime_admission_for_brief(text, text, text, text, text)",
		readersAndWriters,
	],
	["ops.read_governance_queue()", [...readersAndWriters, "carr_authority"]],
	["ops.rule_delivery_plan(text, text[])", readersAndWriters],
	["ops.rule_pack_index()", readersWritersAndJobs],
	["ops.work_request_card(text, text)", readersAndWriters],
	["ops.foundation_assurance_accepted_manifest(uuid)", []],
	["ops.foundation_assurance_subject_maker(uuid)", []],
] as const;
const triggers = [
	"ops.attempt_receipt_binding_valid()",
	"ops.bind_execution_environment_to_envelope()",
	"ops.refuse_direct_rule_delivery_policy_update()",
	"ops.release_schema_declaration_matches_live()",
	"ops.require_rule_approval_lifecycle_anchor()",
	"ops.sourced_work_request_is_immutable()",
	"ops.sourced_work_shape_receipts_are_immutable()",
	"ops.validate_attempt_environment_evidence()",
	"ops.work_request_withdrawal_receipt_append_only()",
	"public.memory_item_insert_valid()",
	"public.memory_item_plan_anchor_valid()",
];

test("shared definer functions keep only the legacy callers' execute access", async (t) => {
	const { db, setup, cleanup, connectionString } = copyTest();
	await setup();
	let rolesCreated = false;
	try {
		await db.query(
			legacyRoles.map((role) => `create role ${role} nologin;`).join("\n"),
		);
		rolesCreated = true;
		await db.query(`
			alter default privileges grant execute on functions to public;
			grant usage on schema ops to carr_writer;
			${functions
				.map(
					([routine]) => `
				create function ${routine} returns int language sql security definer as 'select 1';
			`,
				)
				.join("\n")}
			${triggers
				.map(
					(routine) => `
				create function ${routine} returns trigger language plpgsql security definer
				as $$ begin new.checked := true; return new; end $$;
			`,
				)
				.join("\n")}
			create table ops.receipt_fixture (checked boolean not null check (checked));
			create trigger validate_receipt before insert on ops.receipt_fixture
				for each row execute function ops.attempt_receipt_binding_valid();
			grant insert on ops.receipt_fixture to carr_writer;
		`);

		const migration = await readSchema("restrict-shared-definer-execute.sql");
		await t.test(
			"migration backs off under routine grant contention",
			async () => {
				const locker = new pg.Client({ connectionString });
				await locker.connect();
				try {
					await locker.query(
						"begin; revoke execute on function ops.attempt_receipt_binding_valid() from public",
					);
					await db.query("set statement_timeout = '4s'");
					await assert.rejects(db.query(migration), { code: "55P03" });
				} finally {
					await db.query("rollback; reset statement_timeout");
					await locker.end();
				}
			},
		);
		await db.query(migration);
		await db.query(migration);
		for (const [routine, allowed] of [
			...functions,
			...triggers.map((routine) => [routine, []] as const),
		]) {
			const { rows } = await db.query(
				`select role from unnest($1::text[]) as role
				where has_function_privilege(role::name, $2, 'execute')
				order by role`,
				[["public", ...legacyRoles, ...appRoles], routine],
			);
			assert.deepEqual(
				rows,
				[...allowed].sort().map((role) => ({ role })),
				routine,
			);
		}
		await db.query(
			"set role carr_writer; insert into ops.receipt_fixture values (false); reset role",
		);
	} finally {
		try {
			await cleanup();
		} finally {
			if (rolesCreated) await asAdmin(`drop role ${legacyRoles.join(", ")}`);
		}
	}
});
