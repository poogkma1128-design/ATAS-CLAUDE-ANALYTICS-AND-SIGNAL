-- A key the backtest runner can be called with, without adding a project secret.
--
-- The runner has to be reachable from two places: a scheduled job inside this
-- database, so experiments keep running while the market is closed, and a
-- person deciding to try something. Neither can use the ingest token: that one
-- belongs to the indicator, lives only in the edge function's environment, and
-- is not readable from SQL, so a scheduled job could never present it.
--
-- The published anon key would be reachable from both, and is exactly what must
-- not be accepted: it ships inside the dashboard bundle, so anyone who has
-- loaded the site would be able to start runs.
--
-- So the runner gets its own keys, kept here as hashes. The plaintext is
-- returned once when a key is issued and is never stored in this table, which
-- is what makes a leak of the table itself worth nothing.

create table public.runner_tokens (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  -- sha256 of the token, hex. Never the token.
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

comment on table public.runner_tokens is
  'Hashes of keys accepted by the backtest function. Revoking is setting revoked_at; the plaintext exists only at the moment issue_runner_token returns it.';

-- No policies, on purpose. The edge function reads this with the service role,
-- which bypasses RLS; nothing signed in through the dashboard has any business
-- reading it, and with RLS on and no policy, nothing can.
alter table public.runner_tokens enable row level security;

-- Issues a key and returns it once. There is deliberately no way to read an
-- existing key back out, so a lost one is reissued rather than recovered.
create or replace function public.issue_runner_token(token_label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.runner_tokens (label, token_hash)
  values (token_label, encode(extensions.digest(token, 'sha256'), 'hex'));

  return token;
end;
$$;

-- Issuing a key is an administrative act, not something a dashboard session may
-- do on its own behalf.
revoke all on function public.issue_runner_token(text) from public, anon, authenticated;
