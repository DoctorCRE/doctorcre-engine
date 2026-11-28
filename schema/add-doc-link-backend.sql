-- Install after add-doc-link-readiness.sql before deploying the backend response fields.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table doc_link add column backend text
	constraint doc_link_backend check (backend in ('claude', 'codex'));
grant update (backend) on doc_link to engine;

commit;
