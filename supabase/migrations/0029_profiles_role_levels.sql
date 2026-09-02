alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (
    role = any (
      array[
        'SUPER_ADMIN'::text,
        'ADMIN'::text,
        'HR'::text,
        'MANAGER'::text,
        'TEAM_LEAD'::text,
        'MANAGEMENT'::text,
        'EMPLOYEE'::text
      ]
    )
  );
