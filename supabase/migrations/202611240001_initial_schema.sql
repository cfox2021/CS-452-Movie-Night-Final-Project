-- Movie Night MVP schema.
-- Run in the Supabase SQL editor or with the Supabase CLI after linking the project.

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  constraint profiles_display_name_length check (
    display_name is null or (
      display_name = btrim(display_name)
      and char_length(display_name) between 2 and 40
    )
  )
);

create unique index profiles_display_name_unique
  on public.profiles (lower(display_name))
  where display_name is not null;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  created_by uuid not null references public.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  invited_user_id uuid not null references public.profiles (user_id) on delete cascade,
  invited_by uuid not null references public.profiles (user_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint group_invites_not_self check (invited_user_id <> invited_by)
);

create unique index group_invites_one_pending_per_user
  on public.group_invites (group_id, invited_user_id)
  where status = 'pending';

create table public.movies (
  tmdb_id bigint primary key check (tmdb_id > 0),
  title text not null check (char_length(btrim(title)) > 0),
  release_date date,
  poster_path text,
  overview text,
  updated_at timestamptz not null default now()
);

create table public.movie_nights (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references public.profiles (user_id) on delete restrict,
  title text not null default 'Movie night'
    check (char_length(btrim(title)) between 2 and 80),
  scheduled_for timestamptz,
  status text not null default 'planning'
    check (status in ('planning', 'decided', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  movie_night_id uuid not null references public.movie_nights (id) on delete cascade,
  movie_tmdb_id bigint not null references public.movies (tmdb_id) on delete restrict,
  suggested_by uuid not null references public.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (movie_night_id, movie_tmdb_id)
);

create table public.votes (
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  vote_value boolean not null,
  updated_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);

create table public.viewings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  movie_tmdb_id bigint not null references public.movies (tmdb_id) on delete restrict,
  watched_at date not null default current_date,
  rating numeric(3, 1) check (rating between 0 and 10),
  review text check (review is null or char_length(review) <= 5000),
  created_at timestamptz not null default now(),
  unique (user_id, movie_tmdb_id, watched_at)
);

create index group_members_user_id_idx on public.group_members (user_id);
create index group_invites_invited_user_status_idx
  on public.group_invites (invited_user_id, status);
create index movie_nights_group_id_idx on public.movie_nights (group_id);
create index suggestions_movie_night_id_idx on public.suggestions (movie_night_id);
create index votes_user_id_idx on public.votes (user_id);
create index viewings_user_watched_at_idx on public.viewings (user_id, watched_at desc);

-- These helpers let policies check membership without recursive RLS queries.
create or replace function public.is_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = target_group_id
      and gm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_group_owner(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = target_group_id
      and gm.user_id = (select auth.uid())
      and gm.role = 'owner'
  );
$$;

create or replace function public.is_movie_night_member(target_movie_night_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.movie_nights mn
    join public.group_members gm on gm.group_id = mn.group_id
    where mn.id = target_movie_night_id
      and gm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_suggestion_member(target_suggestion_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.suggestions s
    join public.movie_nights mn on mn.id = s.movie_night_id
    join public.group_members gm on gm.group_id = mn.group_id
    where s.id = target_suggestion_id
      and gm.user_id = (select auth.uid())
  );
$$;

create or replace function public.add_group_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger groups_add_owner_membership
  after insert on public.groups
  for each row execute function public.add_group_owner_membership();

create or replace function public.accept_group_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    if new.invited_user_id <> (select auth.uid()) then
      raise exception 'Only the invited user can accept this invitation';
    end if;
    new.responded_at := now();
    insert into public.group_members (group_id, user_id, role)
    values (new.group_id, new.invited_user_id, 'member')
    on conflict (group_id, user_id) do nothing;
  elsif old.status = 'pending' and new.status = 'declined' then
    if new.invited_user_id <> (select auth.uid()) then
      raise exception 'Only the invited user can decline this invitation';
    end if;
    new.responded_at := now();
  elsif old.status = 'pending' and new.status = 'revoked' then
    if not public.is_group_owner(new.group_id) then
      raise exception 'Only a group owner can revoke this invitation';
    end if;
    new.responded_at := now();
  else
    raise exception 'Invalid invitation status change';
  end if;
  return new;
end;
$$;

create trigger group_invites_handle_response
  before update of status on public.group_invites
  for each row execute function public.accept_group_invite();

-- Create a private profile row automatically when Supabase Auth creates a user.
create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_auth_user();

-- The auth smoke test may already have created a user before this migration runs.
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.movies enable row level security;
alter table public.movie_nights enable row level security;
alter table public.suggestions enable row level security;
alter table public.votes enable row level security;
alter table public.viewings enable row level security;

-- Profiles expose only app profile fields (no email address is stored here).
create policy "Authenticated users can find profiles"
  on public.profiles for select to authenticated using (true);
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Members can view their groups"
  on public.groups for select to authenticated using (public.is_group_member(id));
create policy "Users can create groups"
  on public.groups for insert to authenticated with check (created_by = (select auth.uid()));
create policy "Owners can update their groups"
  on public.groups for update to authenticated
  using (public.is_group_owner(id))
  with check (public.is_group_owner(id));
create policy "Owners can delete their groups"
  on public.groups for delete to authenticated using (public.is_group_owner(id));

create policy "Members can see group membership"
  on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
create policy "Members can leave groups and owners can remove members"
  on public.group_members for delete to authenticated
  using (
    (user_id = (select auth.uid()) and role <> 'owner')
    or (public.is_group_owner(group_id) and user_id <> (select auth.uid()))
  );

create policy "Group members can view invitations"
  on public.group_invites for select to authenticated
  using (
    invited_user_id = (select auth.uid())
    or public.is_group_member(group_id)
  );
create policy "Group members can invite users"
  on public.group_invites for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and public.is_group_member(group_id)
  );
create policy "Invitees can respond and owners can revoke"
  on public.group_invites for update to authenticated
  using (
    (invited_user_id = (select auth.uid()) and status = 'pending')
    or (public.is_group_owner(group_id) and status = 'pending')
  )
  with check (
    (invited_user_id = (select auth.uid()) and status in ('accepted', 'declined'))
    or (public.is_group_owner(group_id) and status = 'revoked')
  );

-- Movie rows contain shared, non-private TMDB metadata.
create policy "Authenticated users can read movie metadata"
  on public.movies for select to authenticated using (true);
create policy "Authenticated users can add movie metadata"
  on public.movies for insert to authenticated with check (true);
create policy "Authenticated users can update movie metadata"
  on public.movies for update to authenticated using (true) with check (true);

create policy "Members can view movie nights"
  on public.movie_nights for select to authenticated
  using (public.is_group_member(group_id));
create policy "Members can create movie nights"
  on public.movie_nights for insert to authenticated
  with check (created_by = (select auth.uid()) and public.is_group_member(group_id));
create policy "Members can update movie nights"
  on public.movie_nights for update to authenticated
  using (
    (created_by = (select auth.uid()) or public.is_group_owner(group_id))
    and public.is_group_member(group_id)
  )
  with check (
    (created_by = (select auth.uid()) or public.is_group_owner(group_id))
    and public.is_group_member(group_id)
  );
create policy "Creators and owners can delete movie nights"
  on public.movie_nights for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_group_owner(group_id));

create policy "Members can view suggestions"
  on public.suggestions for select to authenticated
  using (public.is_movie_night_member(movie_night_id));
create policy "Members can suggest movies"
  on public.suggestions for insert to authenticated
  with check (
    suggested_by = (select auth.uid())
    and public.is_movie_night_member(movie_night_id)
  );
create policy "Suggesters can remove their suggestions"
  on public.suggestions for delete to authenticated
  using (suggested_by = (select auth.uid()));

create policy "Members can see votes"
  on public.votes for select to authenticated
  using (public.is_suggestion_member(suggestion_id));
create policy "Members can vote for themselves"
  on public.votes for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_suggestion_member(suggestion_id));
create policy "Members can change their own vote"
  on public.votes for update to authenticated
  using (user_id = (select auth.uid()) and public.is_suggestion_member(suggestion_id))
  with check (user_id = (select auth.uid()) and public.is_suggestion_member(suggestion_id));
create policy "Members can remove their own vote"
  on public.votes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can view their private watch history"
  on public.viewings for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can add to their private watch history"
  on public.viewings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Users can edit their private watch history"
  on public.viewings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their private watch history"
  on public.viewings for delete to authenticated using (user_id = (select auth.uid()));
