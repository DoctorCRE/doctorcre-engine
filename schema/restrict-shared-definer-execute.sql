begin;

revoke execute on function
	ops.attempt_receipt_binding_valid(),
	ops.bind_execution_environment_to_envelope(),
	ops.engineering_admission_source(text),
	ops.engineering_passport_facts(text),
	ops.foundation_assurance_accepted_manifest(uuid),
	ops.foundation_assurance_subject_maker(uuid),
	ops.hermes_runtime_admission_for_brief(text, text, text, text, text),
	ops.read_governance_queue(),
	ops.refuse_direct_rule_delivery_policy_update(),
	ops.release_schema_declaration_matches_live(),
	ops.require_rule_approval_lifecycle_anchor(),
	ops.rule_delivery_plan(text, text[]),
	ops.rule_pack_index(),
	ops.sourced_work_request_is_immutable(),
	ops.sourced_work_shape_receipts_are_immutable(),
	ops.validate_attempt_environment_evidence(),
	ops.work_request_card(text, text),
	ops.work_request_withdrawal_receipt_append_only(),
	public.memory_item_insert_valid(),
	public.memory_item_plan_anchor_valid()
from public;

-- Existing triggers still fire, and the foundation assurance helpers run under their owner's role.
grant execute on function
	ops.engineering_admission_source(text),
	ops.engineering_passport_facts(text),
	ops.rule_pack_index()
to carr_reader, carr_writer, carr_jobs;

grant execute on function
	ops.hermes_runtime_admission_for_brief(text, text, text, text, text),
	ops.rule_delivery_plan(text, text[]),
	ops.work_request_card(text, text)
to carr_reader, carr_writer;

grant execute on function ops.read_governance_queue() to carr_reader, carr_writer, carr_authority;

commit;
