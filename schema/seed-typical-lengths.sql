-- Default typical to-do lengths for lease deals, as approved on 2026-11-25 (#1386). Run after add-typical-lengths.sql.
-- A deal kind not yet present gets no rows, and a row already stored keeps its days, so this can run again.
begin;
set local search_path = next, pg_temp;
select set_config('engine.job', 'agent', true), set_config('engine.user_id', '', true);

insert into typical_length (deal_kind, todo, days)
select k.slug, d.todo, d.days
from (values
	('lease', 'before_research', 7),
	('lease', 'representation', 7),
	('lease', 'requirements', 7),
	('lease', 'market_survey', 7),
	('lease', 'tour_notes', 12),
	('lease', 'loi_submission', 14),
	('lease', 'loi_grid', 21),
	('lease', 'business_terms', 20),
	('lease', 'contract_draft', 10),
	('lease', 'attorney_comments', 21),
	('lease', 'legal_review', 10),
	('lease', 'ti_scope', 14),
	('lease', 'executed_lease', 14),
	('lease', 'commencement_letter', 10),
	('lease', 'executed_comp', 7),
	('lease', 'expiration_recorded', 6),
	('lease', 'check_in_90_day', 90),
	('lease', 'invoice_recorded', 3),
	('lease', 'commission_received', 30)
) d (deal_kind, todo, days)
join deal_kind k on k.slug = d.deal_kind
on conflict do nothing;

commit;
