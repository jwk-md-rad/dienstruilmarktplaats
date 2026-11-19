# Handleiding: database instellen (stap voor stap)

Duur: ongeveer 10 minuten. Doe dit op een **laptop of computer**, niet op je telefoon.
Je hoeft niets te installeren en het is gratis.

Supabase verandert soms de knoppen een beetje. Zie je iets anders dan hier staat? Zoek dan naar een knop met ongeveer dezelfde naam.

---

## Deel A — Account maken

1. Ga naar **https://supabase.com**
2. Klik rechtsboven op **Start your project** (of **Sign in**).
3. Klik op **Continue with GitHub**. Je logt dan in met je GitHub-account, dus je hoeft geen nieuw wachtwoord te bedenken.
   - Vraagt GitHub om toestemming ("Authorize Supabase")? Klik op **Authorize**.
4. Wordt er gevraagd om een **organization** te maken? Vul dan in:
   - **Name:** je eigen naam of `Dienstruil`
   - **Type:** `Personal`
   - **Plan:** `Free - $0/month`
   - Klik op **Create organization**.

## Deel B — Project (de database) maken

5. Klik op **New project**. Misschien sta je al op dat scherm.
6. Vul het formulier in:
   - **Project name:** `dienstruil`
   - **Database Password:** klik op **Generate a password**. Je hoeft dit wachtwoord niet te onthouden of op te schrijven.
   - **Region:** kies **Central EU (Frankfurt)**. Staat die er niet bij, kies dan een andere met "EU" erin.
     *(Dit kun je later niet meer veranderen.)*
   - **Data access / Security**-schuifjes (als je die ziet):
     - **Enable Data API:** ✅ aan
     - **Grant API access to new tables automatically:** ⬜ uit
     - **Enable RLS on new tables automatically:** ✅ aan
7. Klik op **Create new project**.
8. Wacht 1 à 2 minuten tot het project klaar is. Je ziet dan een overzichtspagina.

## Deel C — De database vullen (kopiëren en plakken)

9. Open in een **nieuw tabblad** het bestand met de databasecode:
   **https://github.com/jwk-md-rad/dienstruilmarktplaats/blob/main/supabase/schema.sql**
10. Klik rechtsboven in dat bestand op het **kopieer-icoontje** (twee vierkantjes over elkaar, met de tekst "Copy raw file"). Nu staat alle code in je klembord.
11. Ga terug naar het Supabase-tabblad.
12. Klik in de **linkerbalk** op **SQL Editor**. Het icoontje ziet eruit als een venstertje met `>_`. Ga met je muis over de icoontjes om de namen te zien.
13. Je ziet een groot leeg tekstvak. Staat daar al tekst? Klik erin en druk op **Ctrl+A** (Mac: **Cmd+A**) en daarna op **Delete**.
14. Klik in het lege tekstvak en plak met **Ctrl+V** (Mac: **Cmd+V**).
15. Klik rechtsonder op de groene knop **Run**.
    - Verschijnt er een waarschuwing (bijv. *"Potential issue detected"* of *"destructive operation"*)? Klik dan op **Run this query** / **Confirm**. Dat is normaal.
16. Onderin moet nu staan: **Success. No rows returned** ✅

## Deel D — Je wachtwoorden instellen

Bedenk eerst twee wachtwoorden:

| Wat | Voor wie | Voorbeeld |
| --- | --- | --- |
| **Groepswachtwoord** (min. 4 tekens) | Voor de hele groep, komt in de WhatsApp-groep | `ruil2026` |
| **Beheercode** (min. 6 tekens) | Alleen voor jou, voor als iemand zijn pincode kwijt is | `beheer-8341` |

17. Maak het tekstvak in de SQL Editor weer leeg (**Ctrl+A**, **Delete**).
18. Kopieer deze regel en plak hem in het tekstvak:
    ```sql
    select dr_instellen('GROEPSWACHTWOORD', 'BEHEERCODE');
    ```
19. Vervang `GROEPSWACHTWOORD` en `BEHEERCODE` door je eigen wachtwoorden. **Laat de enkele aanhalingstekens `'` staan.**
    Voorbeeld: `select dr_instellen('ruil2026', 'beheer-8341');`
20. Klik op **Run**.
21. Onderin moet nu **Ingesteld.** staan ✅
22. Schrijf je beheercode ergens veilig op.

> Wil je later een ander wachtwoord? Herhaal dan stap 17 t/m 21 met de nieuwe wachtwoorden.

## Deel E — Twee gegevens opzoeken en doorgeven

De website moet weten waar de database staat. Daarvoor heb je twee gegevens nodig.

23. Klik **bovenaan** de pagina op de knop **Connect**.
    - Zie je die niet? Klik dan linksonder op het **tandwiel** (**Project Settings**) en daarna op **API Keys** en **Data API**.
24. Zoek en kopieer:
    - **Project URL:** begint met `https://` en eindigt op `.supabase.co`
    - **Publishable key** (begint met `sb_publishable_`), **of** de **anon public**-key (een lange code die begint met `eyJ`)
25. Stuur deze twee aan Claude of aan degene die de site beheert. Die vult ze in en zet de site online.

> ⚠️ **Nooit doorsturen:** de **secret key** of **service_role key**. Die geeft volledige toegang tot alles.
> De Project URL en de publishable/anon key mag je gewoon delen. Daarmee kom je niet in de site zonder het groepswachtwoord.

---

## Klaar! 🎉

Iets mis gegaan? Dit zijn de meest voorkomende oplossingen:

| Probleem | Oplossing |
| --- | --- |
| Rode foutmelding bij stap 15 | Heb je wel **alles** gekopieerd? Maak het tekstvak leeg en begin opnieuw bij stap 10. Opnieuw uitvoeren kan geen kwaad. |
| `function dr_instellen does not exist` | Stap 15 is niet gelukt. Doe Deel C opnieuw. |
| `Groepswachtwoord minimaal 4 tekens…` | Kies langere wachtwoorden (stap 19). |
| Ik zie geen **Run**-knop | Je kunt ook **Ctrl+Enter** (Mac: **Cmd+Enter**) gebruiken. |
| De site doet het na een tijdje niet meer | Gratis projecten pauzeren na een week zonder gebruik. Log in bij supabase.com, open het project en klik op **Restore project**. |
