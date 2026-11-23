-- Lets the sign-in login link a provisioned partner's first Google account (#1221).
begin;
set local lock_timeout = '1s';
grant insert (id, "userId", "providerId", "accountId", "accessToken", "refreshToken", "idToken",
	"accessTokenExpiresAt", "refreshTokenExpiresAt", scope, "createdAt", "updatedAt")
	on doctorcre_auth.account to engine_partner_auth;
commit;
