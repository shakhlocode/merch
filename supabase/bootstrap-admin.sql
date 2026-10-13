-- Run in the NEW project's SQL Editor AFTER this user signs in once.
-- Does not create a password or modify another user's account.
begin;
do $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email)='shahlo.kham@gmail.com';
  if v_user is null then
    raise exception 'First sign in to the new website as shahlo.kham@gmail.com, then rerun this script';
  end if;
  update public.employees set is_admin=true,is_active=true where id=v_user;
  if not found then raise exception 'Employee profile missing: check the auth creation trigger'; end if;
end; $$;
commit;
