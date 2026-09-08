-- Make Telegram delivery observable without rewriting historical uncertainty.
alter table public.signals
  add column if not exists telegram_status text,
  add column if not exists telegram_error text;

update public.signals
set telegram_status = case
  when telegram_message_id is not null then 'sent'
  else 'legacy_unknown'
end
where telegram_status is null;

alter table public.signals
  alter column telegram_status set default 'pending',
  alter column telegram_status set not null;

alter table public.signals
  add constraint signals_telegram_status_is_known check (
    telegram_status in (
      'pending',
      'legacy_unknown',
      'skipped_historical',
      'skipped_rule_disabled',
      'skipped_muted',
      'skipped_unconfigured',
      'sent',
      'failed'
    )
  );

create index if not exists signals_telegram_failures
  on public.signals (fired_at desc)
  where telegram_status = 'failed';

comment on column public.signals.telegram_status is
  'Delivery lifecycle for the original Telegram alert; legacy_unknown preserves pre-migration ambiguity.';
comment on column public.signals.telegram_error is
  'Bounded Telegram API or transport error when telegram_status=failed.';

-- ROLLBACK
-- drop index if exists public.signals_telegram_failures;
-- alter table public.signals drop constraint if exists signals_telegram_status_is_known;
-- alter table public.signals drop column if exists telegram_error;
-- alter table public.signals drop column if exists telegram_status;
