create table if not exists public.shift_overrides (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text not null default '',
  created timestamp with time zone not null default now(),
  updated timestamp with time zone not null default now(),

  constraint shift_overrides_date_check
    check (end_date >= start_date)
);

create index if not exists idx_shift_overrides_org
  on public.shift_overrides(organization_id);

create index if not exists idx_shift_overrides_employee_dates
  on public.shift_overrides(organization_id, employee_id, start_date, end_date);

create index if not exists idx_shift_overrides_shift
  on public.shift_overrides(shift_id);

alter table public.shift_overrides enable row level security;

drop policy if exists "shift_overrides_select" on public.shift_overrides;
create policy "shift_overrides_select"
  on public.shift_overrides
  for select
  using (
    is_super_admin()
    or organization_id = auth_org_id()
  );

drop policy if exists "shift_overrides_insert" on public.shift_overrides;
create policy "shift_overrides_insert"
  on public.shift_overrides
  for insert
  with check (
    is_super_admin()
    or (
      organization_id = auth_org_id()
      and auth_role() = any(array['ADMIN'::text, 'HR'::text])
    )
  );

drop policy if exists "shift_overrides_update" on public.shift_overrides;
create policy "shift_overrides_update"
  on public.shift_overrides
  for update
  using (
    is_super_admin()
    or (
      organization_id = auth_org_id()
      and auth_role() = any(array['ADMIN'::text, 'HR'::text])
    )
  );

drop policy if exists "shift_overrides_delete" on public.shift_overrides;
create policy "shift_overrides_delete"
  on public.shift_overrides
  for delete
  using (
    is_super_admin()
    or (
      organization_id = auth_org_id()
      and auth_role() = any(array['ADMIN'::text, 'HR'::text])
    )
  );

drop trigger if exists trg_shift_overrides_updated_at on public.shift_overrides;

create trigger trg_shift_overrides_updated_at
before update on public.shift_overrides
for each row execute function set_updated_at();