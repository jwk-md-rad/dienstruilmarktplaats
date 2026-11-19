# Dienstruil

Eén overzichtelijke plek om AMC/VUmc-diensten te ruilen, in plaats van de WhatsApp-groep.

- **Aanbieden:** datum aanklikken in de kalender → dag of avond kiezen (alleen in weekend/op feestdagen; doordeweeks is het altijd avond) → AMC of VUmc → naam + eigen pincode.
- **Reageren:** met je naam: *overnemen* (zonder terugdienst), *ruilen* (met een eigen voorstel: datum, dag/avond, locatie) of *kan niet*.
- **Accepteren/weigeren:** alleen de aanbieder, met de pincode. Bij accepteren vervallen de andere voorstellen.
- **Afhandelen:** alleen de aanbieder, met pincode én het vinkje *"De dienst is geruild én doorgegeven aan het rooster"*.
- **Statussen:** 🟢 Open → 🟡 Afgesproken → ✅ Afgehandeld (grijs).
- **Overzicht:** lijst of maandkalender, filters op status en locatie. Verlopen datums verdwijnen uit het overzicht (aan te zetten via "Toon verlopen").
- **Toegang:** één groepswachtwoord. De beheerder heeft een beheercode die als pincode werkt op elk aanbod (voor kwijtgeraakte pincodes).

Techniek: een statische website (`docs/`) op GitHub Pages en een gratis Supabase-database (`supabase/schema.sql`). Er is geen build-stap. Groepswachtwoord en pincodes worden aan de serverkant gecontroleerd. De tabellen zijn niet rechtstreeks toegankelijk.

---

## Installatie (eenmalig, ±15 minuten)

### 1. Database aanmaken bij Supabase (gratis)

> 👉 Uitgebreide versie met elke klik uitgelegd: **[HANDLEIDING-DATABASE.md](HANDLEIDING-DATABASE.md)**

1. Ga naar [supabase.com](https://supabase.com) en maak een account (inloggen met GitHub kan).
2. Klik **New project**:
   - Naam: `dienstruil`
   - Region: **Central EU (Frankfurt)** of **West EU (Ireland)**
   - Database password: laat er een genereren. Je hebt het verder niet nodig.
3. Wacht tot het project klaar is (±1 minuut).
4. Open links **SQL Editor** → **New query**. Plak de volledige inhoud van [`supabase/schema.sql`](supabase/schema.sql) en klik **Run**.
5. Maak nog een **New query** met je eigen wachtwoorden en klik **Run**:
   ```sql
   select dr_instellen('KIES-EEN-GROEPSWACHTWOORD', 'KIES-EEN-BEHEERCODE');
   ```
   - Het **groepswachtwoord** (min. 4 tekens) deel je met de groep, bijvoorbeeld in de beschrijving van de WhatsApp-groep.
   - De **beheercode** (min. 6 tekens) houd je voor jezelf.
   - Later wijzigen? Voer dezelfde regel opnieuw uit met nieuwe waarden.

### 2. Website koppelen aan de database

1. Ga in Supabase naar **Project Settings → API** (of klik bovenaan op **Connect**).
2. Kopieer de **Project URL** en de **anon public**-key (soms heet die **publishable key**).
3. Open in GitHub het bestand `docs/config.js`, klik op het potloodje en vul beide in:
   ```js
   window.DIENSTRUIL_CONFIG = {
     SUPABASE_URL: "https://xxxxxxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJ..."
   };
   ```
   Deze sleutel mag openbaar zijn: zonder groepswachtwoord kun je er niets mee.
   Gebruik **nooit** de `service_role`/`secret` key.
4. Klik **Commit changes**.

### 3. Online zetten met GitHub Pages (gratis)

1. In deze repository: **Settings → Pages**.
2. Bij *Source*: **Deploy from a branch**, branch **main**, map **/docs** → **Save**.
3. Na ±1 minuut staat de site op `https://<gebruikersnaam>.github.io/dienstruilmarktplaats/`.
4. Deel die link plus het groepswachtwoord in de WhatsApp-groep. Tip voor collega's: via *Deel → Zet op beginscherm* staat de site als app-icoon op de telefoon.

> GitHub Pages is gratis voor **openbare** repositories. Voor een privé-repository heb je GitHub Pro nodig. In de code staan geen geheimen, dus een openbare repository is prima. De gegevens zelf staan in Supabase, achter het groepswachtwoord.

---

## Goed om te weten

- **Gratis Supabase-projecten pauzeren na ±7 dagen zonder gebruik.** Bij normaal gebruik door de groep gebeurt dat niet. Staat de site toch op pauze, log dan in bij Supabase en klik **Restore project**.
- **Pincode kwijt?** Vul als beheerder je beheercode in op de plek van de pincode.
- **Iemand heeft per ongeluk geaccepteerd?** Kies bij het aanbod "Afspraak gaat niet door". Het aanbod gaat dan weer open.
- **Data bekijken/exporteren:** in Supabase onder **Table Editor** (tabellen `aanbiedingen` en `reacties`).
- **Schema bijwerken:** `supabase/schema.sql` kan veilig opnieuw worden uitgevoerd. Bestaande gegevens blijven staan.

## Bestanden

| Pad | Wat |
| --- | --- |
| `docs/index.html`, `docs/app.js`, `docs/style.css` | De website |
| `docs/config.js` | Supabase-URL en publieke sleutel |
| `supabase/schema.sql` | Tabellen, beveiliging en alle functies |
