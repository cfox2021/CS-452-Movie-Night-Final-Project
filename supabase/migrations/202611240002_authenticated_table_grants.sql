-- RLS policies filter rows, but PostgreSQL table grants are also required.
-- These grants let signed-in users reach the tables; the policies in the
-- initial schema still decide which rows they can read or change.

grant select, insert, update
  on table public.profiles
  to authenticated;

grant select, insert, update, delete
  on table public.groups
  to authenticated;

grant select, delete
  on table public.group_members
  to authenticated;

grant select, insert, update
  on table public.group_invites
  to authenticated;

grant select, insert, update
  on table public.movies
  to authenticated;

grant select, insert, update, delete
  on table public.movie_nights
  to authenticated;

grant select, insert, delete
  on table public.suggestions
  to authenticated;

grant select, insert, update, delete
  on table public.votes
  to authenticated;

grant select, insert, update, delete
  on table public.viewings
  to authenticated;
