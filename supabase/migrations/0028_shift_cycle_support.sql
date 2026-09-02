alter table public.shifts
  add column if not exists schedule_type text not null default 'WEEKLY',
  add column if not exists cycle_work_days integer,
  add column if not exists cycle_off_days integer,
  add column if not exists cycle_start_date date;

alter table public.shifts
  drop constraint if exists shifts_schedule_type_check;

alter table public.shifts
  add constraint shifts_schedule_type_check
  check (schedule_type in ('WEEKLY', 'CYCLE'));

alter table public.shifts
  drop constraint if exists shifts_cycle_values_check;

alter table public.shifts
  add constraint shifts_cycle_values_check
  check (
    schedule_type = 'WEEKLY'
    or (
      cycle_work_days is not null
      and cycle_work_days > 0
      and cycle_off_days is not null
      and cycle_off_days > 0
      and cycle_start_date is not null
    )
  );