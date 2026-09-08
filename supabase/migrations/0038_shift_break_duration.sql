-- Add unpaid/excluded break duration to shifts.
-- Used to calculate planned working hours.
-- Example: 09:00-21:00 with 90 minutes of breaks = 10.5 planned hours.

alter table public.shifts
  add column if not exists break_duration_minutes integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shifts_break_duration_minutes_check'
      and conrelid = 'public.shifts'::regclass
  ) then
    alter table public.shifts
      add constraint shifts_break_duration_minutes_check
      check (
        break_duration_minutes >= 0
        and break_duration_minutes < 1440
      );
  end if;
end $$;