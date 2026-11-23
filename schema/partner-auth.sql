-- Apply as the migration owner after next.sql. Provision identities separately.
begin;
set local lock_timeout = '1s';

do $$ begin
	begin
		create role engine_partner_auth nologin;
	exception when duplicate_object or unique_violation then null;
	end;
	if exists (select from pg_roles where rolname = 'engine_partner_auth'
			and (rolcanlogin or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication))
		or exists (select from pg_auth_members where member = 'engine_partner_auth'::regrole) then
		raise exception 'engine_partner_auth holds rights beyond its grants';
	end if;
end $$;

create schema doctorcre_auth;
revoke all on schema doctorcre_auth from public;

create table doctorcre_auth."user" (
	id text primary key,
	partner_user_id uuid not null unique references next.app_user (id),
	name text not null,
	email text not null unique,
	"emailVerified" boolean not null check ("emailVerified"),
	image text,
	"createdAt" timestamptz not null,
	"updatedAt" timestamptz not null
);

create table doctorcre_auth.account (
	id text primary key,
	"userId" text not null unique references doctorcre_auth."user" (id) on delete cascade,
	"providerId" text not null check ("providerId" = 'google'),
	"accountId" text not null unique check ("accountId" ~ '\S'),
	"accessToken" text check ("accessToken" is null),
	"refreshToken" text check ("refreshToken" is null),
	"idToken" text check ("idToken" is null),
	"accessTokenExpiresAt" timestamptz,
	"refreshTokenExpiresAt" timestamptz,
	scope text,
	password text check (password is null),
	"createdAt" timestamptz not null,
	"updatedAt" timestamptz not null
);

create table doctorcre_auth.session (
	id text primary key,
	"userId" text not null references doctorcre_auth."user" (id) on delete cascade,
	token text not null unique check (token ~ '\S'),
	origin text not null check (origin ~ '^https://[^/?#]+$'),
	"csrfToken" text not null check ("csrfToken" ~ '\S'),
	"googleAuthenticatedAt" timestamptz not null,
	"createdAt" timestamptz not null,
	"expiresAt" timestamptz not null,
	"updatedAt" timestamptz not null,
	"ipAddress" text,
	"userAgent" text,
	check ("expiresAt" > "createdAt" and "expiresAt" <= "createdAt" + interval '720 hours'),
	check ("googleAuthenticatedAt" >= "createdAt" and "googleAuthenticatedAt" < "expiresAt")
);
create index on doctorcre_auth.session ("userId");

create table doctorcre_auth.verification (
	id text primary key,
	identifier text not null,
	value text not null,
	"expiresAt" timestamptz not null,
	"createdAt" timestamptz not null,
	"updatedAt" timestamptz not null
);
create index on doctorcre_auth.verification (identifier);

create view doctorcre_auth.partner as
	select u.id as auth_user_id, p.id as app_user_id, p.slug, n.name as display
	from doctorcre_auth."user" u
	join doctorcre_auth.account a on a."userId" = u.id
	join next.app_user p on p.id = u.partner_user_id
	join next.party n on n.id = p.id
	where p.is_account_partner;

revoke execute on function public.tool_call_expire() from public;
revoke all on all tables in schema doctorcre_auth from public;
grant usage on schema doctorcre_auth to engine_partner_auth;
grant select on doctorcre_auth."user", doctorcre_auth.account, doctorcre_auth.partner to engine_partner_auth;
grant insert (id, "userId", "providerId", "accountId", "accessToken", "refreshToken", "idToken",
	"accessTokenExpiresAt", "refreshTokenExpiresAt", scope, "createdAt", "updatedAt")
	on doctorcre_auth.account to engine_partner_auth;
grant select, insert, delete on doctorcre_auth.session to engine_partner_auth;
grant update ("googleAuthenticatedAt", "updatedAt") on doctorcre_auth.session to engine_partner_auth;
grant select, insert, update, delete on doctorcre_auth.verification to engine_partner_auth;

commit;
