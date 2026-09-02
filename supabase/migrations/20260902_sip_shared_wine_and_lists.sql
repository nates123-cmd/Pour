-- Sip: a shared wine list, private beer and spirits, and a To try / Tried split.
--
-- This repo is NOT linked to the suite project and nothing here is applied
-- automatically. It is kept as the record of what was run by hand against
-- xsmnfcmtbpeaccnyinkr on 2026-09-02. sip_tastings held ZERO rows at the time,
-- so none of this needed a backfill.

-- 1. Household membership, app-neutral.
--
-- public.household_members(owner_id, member_email) already exists -- Stock built
-- it, keyed by EMAIL so a member can be added before they have ever signed in.
-- stock_owner_ids() reads it, but that name says Stock, and Sip is not Stock.
-- Same body, neutral name, so a third app does not need a fourth copy.
create or replace function public.household_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select auth.uid()
  union
  select hm.owner_id
    from public.household_members hm
   where lower(hm.member_email) = lower(auth.jwt() ->> 'email')
$$;

-- Supabase default-grants EXECUTE on new public functions to anon, and
-- `revoke ... from public` does NOT take that away. anon must be named.
revoke all on function public.household_ids() from public, anon;
grant execute on function public.household_ids() to authenticated;

-- 2. Wine is shared across the household; beer and spirits are not.
--
-- One list of bottles, one rating per bottle, either of them can set or change
-- it. Beer and spirits stay strictly auth.uid() = user_id: two people who share
-- a cellar do not necessarily share a taste in whisky.
--
-- INSERT stays your own row in every category -- you add as yourself, so the
-- category on a new row cannot be used to write into someone else's silo.
drop policy if exists sip_tastings_sel on public.sip_tastings;
drop policy if exists sip_tastings_ins on public.sip_tastings;
drop policy if exists sip_tastings_upd on public.sip_tastings;
drop policy if exists sip_tastings_del on public.sip_tastings;

create policy sip_tastings_sel on public.sip_tastings for select
  using (
    user_id = auth.uid()
    or (category = 'wine' and user_id in (select public.household_ids()))
  );

create policy sip_tastings_ins on public.sip_tastings for insert
  with check (user_id = auth.uid());

create policy sip_tastings_upd on public.sip_tastings for update
  using (
    user_id = auth.uid()
    or (category = 'wine' and user_id in (select public.household_ids()))
  )
  with check (
    user_id = auth.uid()
    or (category = 'wine' and user_id in (select public.household_ids()))
  );

create policy sip_tastings_del on public.sip_tastings for delete
  using (
    user_id = auth.uid()
    or (category = 'wine' and user_id in (select public.household_ids()))
  );

-- 3. A row with no rating is a bottle you have not tried yet.
--
-- rating was already nullable and its CHECK passes on NULL, so "To try" needs
-- no new column -- it is the absence of a rating. tasted_on defaulted to
-- CURRENT_DATE and was NOT NULL, which would have stamped a tasting date on
-- every wishlist row. It is set when the rating is.
alter table public.sip_tastings alter column tasted_on drop not null;
alter table public.sip_tastings alter column tasted_on drop default;

-- 4. source was rejecting every tag the app actually writes.
--
-- The CHECK allowed only lookup / menu / import, but the client has been
-- sending 'label', 'lookup+obdb' and 'label+obdb' since the brewery confirmer
-- shipped. Every one of them failed and fell back to 'lookup' through the retry
-- in addTasting -- ratings were never lost, but the provenance always was.
alter table public.sip_tastings drop constraint if exists pour_tastings_source_check;
alter table public.sip_tastings add constraint sip_tastings_source_check
  check (source in ('lookup', 'menu', 'import', 'label',
                    'lookup+obdb', 'label+obdb', 'menu+obdb'));
