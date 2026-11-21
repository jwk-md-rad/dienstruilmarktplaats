-- =====================================================================
-- Dienstruil — databaseschema voor Supabase
--
-- Plak dit hele bestand in Supabase > SQL Editor en klik "Run".
-- Daarna één keer (met je eigen wachtwoorden):
--   select dr_instellen('groepswachtwoord', 'beheercode');
--
-- Veiligheid: de tabellen zijn NIET direct leesbaar of schrijfbaar via de
-- publieke API-sleutel. Alles loopt via de functies hieronder, die het
-- groepswachtwoord en de pincodes aan de serverkant controleren.
-- Het bestand kan veilig opnieuw worden uitgevoerd (bijv. na een update).
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

create table if not exists public.instellingen (
  id          int primary key default 1 check (id = 1),
  groep_hash  text not null,
  beheer_hash text not null
);

create table if not exists public.aanbiedingen (
  id             uuid primary key default gen_random_uuid(),
  datum          date not null,
  deel           text not null check (deel in ('dag', 'avond')),
  locatie        text not null check (locatie in ('AMC', 'VU')),
  naam           text not null check (char_length(naam) between 1 and 60),
  pin_hash       text not null,
  notitie        text check (char_length(notitie) <= 300),
  status         text not null default 'open'
                 check (status in ('open', 'afgesproken', 'afgehandeld')),
  aangemaakt     timestamptz not null default now(),
  afgehandeld_op timestamptz
);

create table if not exists public.reacties (
  id           uuid primary key default gen_random_uuid(),
  aanbod_id    uuid not null references public.aanbiedingen(id) on delete cascade,
  soort        text not null check (soort in ('overnemen', 'ruilen', 'kan_niet')),
  naam         text not null check (char_length(naam) between 1 and 60),
  ruil_datum   date,
  ruil_deel    text check (ruil_deel in ('dag', 'avond')),
  ruil_locatie text check (ruil_locatie in ('AMC', 'VU')),
  notitie      text check (char_length(notitie) <= 300),
  status       text not null default 'voorgesteld'
               check (status in ('voorgesteld', 'geaccepteerd', 'geweigerd', 'vervallen')),
  aangemaakt   timestamptz not null default now(),
  constraint ruil_compleet check (
    (soort = 'ruilen') = (ruil_datum is not null and ruil_deel is not null and ruil_locatie is not null)
  )
);

-- Ruilen mag ook zonder datum: dan kiest de aanbieder zelf een dienst van de
-- ruiler (bij het accepteren). Werkt ook op een bestaande database.
alter table public.reacties drop constraint if exists ruil_compleet;
alter table public.reacties add constraint ruil_compleet check (
  (ruil_datum is null) = (ruil_deel is null)
  and (ruil_datum is null) = (ruil_locatie is null)
  and (soort = 'ruilen' or ruil_datum is null)
);

create index if not exists aanbiedingen_datum_idx on public.aanbiedingen (datum);
create index if not exists reacties_aanbod_idx on public.reacties (aanbod_id);

-- Geen directe toegang voor de publieke sleutel: RLS aan, geen policies.
alter table public.instellingen enable row level security;
alter table public.aanbiedingen enable row level security;
alter table public.reacties     enable row level security;
revoke all on public.instellingen, public.aanbiedingen, public.reacties from anon, authenticated;

-- ---------------------------------------------------------------------
-- Interne hulpfuncties (niet aanroepbaar via de API)
-- ---------------------------------------------------------------------

create or replace function public._dr_vandaag() returns date
language sql stable as $$
  select (now() at time zone 'Europe/Amsterdam')::date
$$;

create or replace function public._dr_check_groep(p_groep text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare h text;
begin
  select groep_hash into h from instellingen where id = 1;
  if h is null then
    raise exception 'De site is nog niet ingesteld (groepswachtwoord ontbreekt).';
  end if;
  if p_groep is null or crypt(p_groep, h) <> h then
    raise exception 'Onjuist groepswachtwoord.';
  end if;
end $$;

-- Controleert pincode van het aanbod óf de beheercode.
create or replace function public._dr_check_pin(p_aanbod uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare ph text; bh text;
begin
  select pin_hash into ph from aanbiedingen where id = p_aanbod;
  if ph is null then
    raise exception 'Aanbod niet gevonden.';
  end if;
  select beheer_hash into bh from instellingen where id = 1;
  if p_pin is not null and (crypt(p_pin, ph) = ph or (bh is not null and crypt(p_pin, bh) = bh)) then
    return;
  end if;
  raise exception 'Onjuiste pincode.';
end $$;

-- Alleen beheer (SQL Editor): wachtwoorden instellen of wijzigen.
create or replace function public.dr_instellen(p_groep text, p_beheer text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if coalesce(char_length(p_groep), 0) < 4 or coalesce(char_length(p_beheer), 0) < 6 then
    raise exception 'Groepswachtwoord minimaal 4 tekens, beheercode minimaal 6 tekens.';
  end if;
  insert into instellingen (id, groep_hash, beheer_hash)
  values (1, crypt(p_groep, gen_salt('bf')), crypt(p_beheer, gen_salt('bf')))
  on conflict (id) do update
    set groep_hash = excluded.groep_hash, beheer_hash = excluded.beheer_hash;
  return 'Ingesteld.';
end $$;

-- ---------------------------------------------------------------------
-- Publieke functies (aangeroepen door de website)
-- ---------------------------------------------------------------------

create or replace function public.dr_inloggen(p_groep text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform _dr_check_groep(p_groep);
  return true;
end $$;

create or replace function public.dr_overzicht(p_groep text) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare resultaat json;
begin
  perform _dr_check_groep(p_groep);
  select coalesce(json_agg(a order by a.datum, a.aangemaakt), '[]'::json) into resultaat
  from (
    select o.id, o.datum, o.deel, o.locatie, o.naam, o.notitie, o.status,
           o.aangemaakt, o.afgehandeld_op,
           coalesce((
             select json_agg(json_build_object(
                      'id', r.id, 'soort', r.soort, 'naam', r.naam,
                      'ruil_datum', r.ruil_datum, 'ruil_deel', r.ruil_deel,
                      'ruil_locatie', r.ruil_locatie, 'notitie', r.notitie,
                      'status', r.status, 'aangemaakt', r.aangemaakt)
                    order by r.aangemaakt)
             from reacties r where r.aanbod_id = o.id
           ), '[]'::json) as reacties
    from aanbiedingen o
    where o.datum >= _dr_vandaag() - 120
  ) a;
  return resultaat;
end $$;

create or replace function public.dr_aanbod_plaatsen(
  p_groep text, p_datum date, p_deel text, p_locatie text,
  p_naam text, p_pin text, p_notitie text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare nieuw uuid;
begin
  perform _dr_check_groep(p_groep);
  if p_datum is null or p_datum < _dr_vandaag() then
    raise exception 'Kies een datum vandaag of in de toekomst.';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'Pincode moet 4 tot 8 cijfers zijn.';
  end if;
  if coalesce(btrim(p_naam), '') = '' then
    raise exception 'Vul je naam in.';
  end if;
  insert into aanbiedingen (datum, deel, locatie, naam, pin_hash, notitie)
  values (p_datum, p_deel, p_locatie, btrim(p_naam), crypt(p_pin, gen_salt('bf')),
          nullif(btrim(p_notitie), ''))
  returning id into nieuw;
  return nieuw;
end $$;

create or replace function public.dr_reageren(
  p_groep text, p_aanbod uuid, p_soort text, p_naam text,
  p_ruil_datum date default null, p_ruil_deel text default null,
  p_ruil_locatie text default null, p_notitie text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare st text; nieuw uuid;
begin
  perform _dr_check_groep(p_groep);
  select status into st from aanbiedingen where id = p_aanbod;
  if st is null then
    raise exception 'Aanbod niet gevonden.';
  end if;
  if st <> 'open' then
    raise exception 'Op dit aanbod kan niet meer gereageerd worden.';
  end if;
  if coalesce(btrim(p_naam), '') = '' then
    raise exception 'Vul je naam in.';
  end if;
  if p_soort = 'ruilen' then
    -- Alles leeg = de aanbieder kiest zelf een dienst; anders alles verplicht.
    if (p_ruil_datum is null) <> (p_ruil_deel is null) or (p_ruil_datum is null) <> (p_ruil_locatie is null) then
      raise exception 'Kies een datum, dag/avond en locatie voor je ruilvoorstel.';
    end if;
    if p_ruil_datum < _dr_vandaag() then
      raise exception 'Je ruildatum ligt in het verleden.';
    end if;
  else
    p_ruil_datum := null; p_ruil_deel := null; p_ruil_locatie := null;
  end if;
  insert into reacties (aanbod_id, soort, naam, ruil_datum, ruil_deel, ruil_locatie, notitie)
  values (p_aanbod, p_soort, btrim(p_naam), p_ruil_datum, p_ruil_deel, p_ruil_locatie,
          nullif(btrim(p_notitie), ''))
  returning id into nieuw;
  return nieuw;
end $$;

-- Oude versie (zonder terugdienst-parameters) weghalen, anders twee varianten.
drop function if exists public.dr_beslissen(text, uuid, text, boolean);

create or replace function public.dr_beslissen(
  p_groep text, p_reactie uuid, p_pin text, p_accepteren boolean,
  p_ruil_datum date default null, p_ruil_deel text default null, p_ruil_locatie text default null
) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r reacties%rowtype; st text;
begin
  perform _dr_check_groep(p_groep);
  select * into r from reacties where id = p_reactie;
  if r.id is null then
    raise exception 'Reactie niet gevonden.';
  end if;
  perform _dr_check_pin(r.aanbod_id, p_pin);
  select status into st from aanbiedingen where id = r.aanbod_id for update;
  if st <> 'open' or r.soort = 'kan_niet' or r.status <> 'voorgesteld' then
    raise exception 'Over dit voorstel kan niet (meer) beslist worden.';
  end if;
  if p_accepteren then
    -- Ruil zonder datum: de aanbieder kiest nu welke dienst hij/zij overneemt.
    if r.soort = 'ruilen' and r.ruil_datum is null then
      if p_ruil_datum is null or p_ruil_deel is null or p_ruil_locatie is null then
        raise exception 'Kies welke dienst je van % overneemt (datum, dag/avond en locatie).', r.naam;
      end if;
      if p_ruil_datum < _dr_vandaag() then
        raise exception 'Die datum ligt in het verleden.';
      end if;
      update reacties set ruil_datum = p_ruil_datum, ruil_deel = p_ruil_deel, ruil_locatie = p_ruil_locatie
        where id = r.id;
    end if;
    update reacties set status = 'geaccepteerd' where id = r.id;
    update reacties set status = 'vervallen'
      where aanbod_id = r.aanbod_id and id <> r.id
        and soort <> 'kan_niet' and status = 'voorgesteld';
    update aanbiedingen set status = 'afgesproken' where id = r.aanbod_id;
  else
    update reacties set status = 'geweigerd' where id = r.id;
  end if;
end $$;

create or replace function public.dr_afspraak_annuleren(
  p_groep text, p_aanbod uuid, p_pin text
) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare st text;
begin
  perform _dr_check_groep(p_groep);
  perform _dr_check_pin(p_aanbod, p_pin);
  select status into st from aanbiedingen where id = p_aanbod for update;
  if st <> 'afgesproken' then
    raise exception 'Er is geen afspraak om te annuleren.';
  end if;
  update reacties set status = 'geweigerd' where aanbod_id = p_aanbod and status = 'geaccepteerd';
  update reacties set status = 'voorgesteld' where aanbod_id = p_aanbod and status = 'vervallen';
  update aanbiedingen set status = 'open' where id = p_aanbod;
end $$;

create or replace function public.dr_afhandelen(
  p_groep text, p_aanbod uuid, p_pin text, p_bevestigd boolean
) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare st text;
begin
  perform _dr_check_groep(p_groep);
  perform _dr_check_pin(p_aanbod, p_pin);
  if not coalesce(p_bevestigd, false) then
    raise exception 'Bevestig eerst dat de dienst geruild én doorgegeven is aan het rooster.';
  end if;
  select status into st from aanbiedingen where id = p_aanbod for update;
  if st = 'afgehandeld' then
    raise exception 'Dit aanbod is al afgehandeld.';
  end if;
  update reacties set status = 'vervallen'
    where aanbod_id = p_aanbod and soort <> 'kan_niet' and status = 'voorgesteld';
  update aanbiedingen set status = 'afgehandeld', afgehandeld_op = now() where id = p_aanbod;
end $$;

create or replace function public.dr_verwijderen(
  p_groep text, p_aanbod uuid, p_pin text
) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform _dr_check_groep(p_groep);
  perform _dr_check_pin(p_aanbod, p_pin);
  delete from aanbiedingen where id = p_aanbod;
end $$;

-- ---------------------------------------------------------------------
-- Rechten: alleen de dr_-functies voor de website openzetten.
-- ---------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

-- Nodig als "Grant API access to new tables automatically" uit staat.
grant usage on schema public to anon, authenticated;

grant execute on function
  public.dr_inloggen(text),
  public.dr_overzicht(text),
  public.dr_aanbod_plaatsen(text, date, text, text, text, text, text),
  public.dr_reageren(text, uuid, text, text, date, text, text, text),
  public.dr_beslissen(text, uuid, text, boolean, date, text, text),
  public.dr_afspraak_annuleren(text, uuid, text),
  public.dr_afhandelen(text, uuid, text, boolean),
  public.dr_verwijderen(text, uuid, text)
to anon, authenticated;
