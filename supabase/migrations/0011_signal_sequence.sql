-- A short number a person can match between an alert and its result.
--
-- Signals are keyed by uuid, which is right for the database and useless in a
-- Telegram thread: the result arrives as a reply, but the quoted preview is
-- truncated on a phone, so a reply landing under a later alert reads as if it
-- belonged to that one. A real case: the reply "+200 ticks · reached TP" was
-- the 12:15 long resolving, and it rendered directly beneath the 12:25 short,
-- which was still open. Nothing in either message said which was which.
--
-- Numbered per signal rather than per instrument or per rule, because the
-- Telegram chat mixes all of them and the number has to be unique in the place
-- it is actually read.
create sequence if not exists public.signal_seq;

alter table public.signals
  add column if not exists seq bigint;

comment on column public.signals.seq is
  'Human-facing signal number, shown as #S<seq> in Telegram so a result can be matched to its alert.';

-- Existing signals get numbers in the order they fired, so the sequence reads
-- chronologically from the first signal this system ever produced.
with ordered as (
  select id, row_number() over (order by fired_at, id) as rn
    from public.signals
)
update public.signals s
   set seq = o.rn
  from ordered o
 where o.id = s.id
   and s.seq is null;

select setval(
  'public.signal_seq',
  coalesce((select max(seq) from public.signals), 0) + 1,
  false
);

alter table public.signals
  alter column seq set default nextval('public.signal_seq');

-- Backfilled above, so this cannot fail on existing rows. Gaps are expected and
-- harmless: an ignored duplicate insert still consumes a number, and the column
-- is an identifier, not a count of anything.
alter table public.signals
  alter column seq set not null;

create unique index if not exists signals_seq_key on public.signals (seq);

alter sequence public.signal_seq owned by public.signals.seq;
