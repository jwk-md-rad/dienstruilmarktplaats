/* Dienstruil — diensten ruilen voor AMC & VUmc.
   Platte JavaScript, geen build-stap. Data via Supabase RPC-functies
   (zie supabase/schema.sql). */
(function () {
  "use strict";

  const cfg = window.DIENSTRUIL_CONFIG || {};
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const btnNieuw = document.getElementById("btn-nieuw");

  // ------------------------------------------------------------------
  // Opslag (per telefoon) — altijd in try/catch, mag ontbreken
  // ------------------------------------------------------------------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* negeren */ } },
  };

  const state = {
    groep: store.get("dr_groep"),
    naam: store.get("dr_naam") || "",
    aanbod: [],
    geladen: false,
    view: store.get("dr_view") === "kalender" ? "kalender" : "lijst",
    status: "alle",
    locatie: "alle",
    verlopen: false,
    calMonth: startOfMonth(new Date()),
    calSelected: null,
    // Directe link naar één aanbod: ...#aanbod=<id>
    startAanbod: (location.hash.match(/aanbod=([0-9a-f-]{36})/i) || [])[1] || null,
  };

  // ------------------------------------------------------------------
  // Hulpfuncties: tekst & datums
  // ------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseIso(s) { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function todayIso() { return iso(new Date()); }

  const fmtWd = new Intl.DateTimeFormat("nl-NL", { weekday: "short" });
  const fmtMonShort = new Intl.DateTimeFormat("nl-NL", { month: "short" });
  const fmtLong = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fmtMed = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  const fmtMonthYear = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" });
  const fmtStamp = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function longDate(s) { return cap(fmtLong.format(parseIso(s))); }
  function medDate(s) {
    const d = parseIso(s);
    const txt = fmtMed.format(d).replace(".", "");
    return d.getFullYear() !== new Date().getFullYear() ? txt + " " + d.getFullYear() : txt;
  }

  // Nederlandse feestdagen (berekend, incl. Pasen)
  const feestCache = {};
  function pasen(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const maand = Math.floor((h + l - 7 * m + 114) / 31), dag = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, maand - 1, dag);
  }
  function feestdagen(y) {
    if (feestCache[y]) return feestCache[y];
    const p = pasen(y);
    const koning = new Date(y, 3, 27);
    if (koning.getDay() === 0) koning.setDate(26);
    const lijst = [
      [new Date(y, 0, 1), "Nieuwjaarsdag"],
      [addDays(p, -2), "Goede Vrijdag"],
      [p, "1e Paasdag"],
      [addDays(p, 1), "2e Paasdag"],
      [koning, "Koningsdag"],
      [new Date(y, 4, 5), "Bevrijdingsdag"],
      [addDays(p, 39), "Hemelvaartsdag"],
      [addDays(p, 49), "1e Pinksterdag"],
      [addDays(p, 50), "2e Pinksterdag"],
      [new Date(y, 11, 25), "1e Kerstdag"],
      [new Date(y, 11, 26), "2e Kerstdag"],
    ];
    const map = {};
    lijst.forEach(([d, n]) => { map[iso(d)] = n; });
    return (feestCache[y] = map);
  }
  function dagInfo(s) {
    const d = parseIso(s);
    const feest = feestdagen(d.getFullYear())[s] || null;
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    return { weekend, feest, keuze: weekend || !!feest };
  }

  const DEEL = { dag: "Dagdienst", avond: "Avonddienst" };
  const STATUS = { open: "Open", afgesproken: "Afgesproken", afgehandeld: "Afgehandeld" };
  const ROOSTER = esc(cfg.ROOSTERMAKER || "Danny"); // wie het rooster beheert
  const STATUS_UITLEG = {
    open: "Zoekt nog iemand om te ruilen of over te nemen.",
    afgesproken: `De 2 radiologen zijn het eens over de ruil en mailen ${ROOSTER} van het rooster.`,
    afgehandeld: `${ROOSTER} heeft akkoord gegeven en de ruil verwerkt in het rooster.`,
  };

  function dienstTags(datum, deel, locatie) {
    const info = dagInfo(datum);
    let extra = "";
    if (info.feest) extra = `<span class="tag feest">${esc(info.feest)}</span>`;
    else if (info.weekend) extra = `<span class="tag feest">Weekend</span>`;
    return `<span class="tag loc-${esc(locatie)}">${locatie === "VU" ? "VUmc" : "AMC"}</span>` +
      `<span class="tag">${esc(DEEL[deel] || deel)}</span>` + extra;
  }
  function dienstTekst(datum, deel, locatie) {
    return `${medDate(datum)} · ${deel === "dag" ? "dag" : "avond"} · ${locatie === "VU" ? "VUmc" : "AMC"}`;
  }

  // ------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------
  async function rpc(fn, params) {
    const headers = { "Content-Type": "application/json", apikey: cfg.SUPABASE_ANON_KEY };
    if (/^eyJ/.test(cfg.SUPABASE_ANON_KEY || "")) headers.Authorization = "Bearer " + cfg.SUPABASE_ANON_KEY;
    let res;
    try {
      res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST", headers, body: JSON.stringify(params),
      });
    } catch (e) {
      throw new Error("Geen verbinding met de server. Controleer je internet en probeer opnieuw.");
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const msg = (data && data.message) || "Er ging iets mis (" + res.status + ").";
      const err = new Error(msg);
      err.groep = /groepswachtwoord/i.test(msg);
      throw err;
    }
    return data;
  }
  function metGroep(p) { return Object.assign({ p_groep: state.groep }, p); }

  // ------------------------------------------------------------------
  // WhatsApp: deelbericht met directe link (je verstuurt het zelf)
  // ------------------------------------------------------------------
  function zetHash(id) { try { history.replaceState(null, "", "#aanbod=" + id); } catch (e) { /* negeren */ } }
  function wisHash() { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* negeren */ } }
  function aanbodLink(id) { return location.origin + location.pathname + "#aanbod=" + id; }
  function deelTekst(a) {
    const info = dagInfo(a.datum);
    const regels = [
      "🔄 *Dienst te ruil*",
      "*" + longDate(a.datum) + "*",
      (DEEL[a.deel] || a.deel) + " · " + (a.locatie === "VU" ? "VUmc" : "AMC") + (info.feest ? " · " + info.feest : ""),
      "Aangeboden door " + a.naam,
    ];
    if (a.notitie) regels.push("💬 " + a.notitie);
    regels.push("", "Overnemen of ruilen? Reageer via Dienstruil 👇", aanbodLink(a.id));
    return regels.join("\n");
  }
  function waUrl(a) { return "https://wa.me/?text=" + encodeURIComponent(deelTekst(a)); }

  // ------------------------------------------------------------------
  // Mail aan de roostermaker bij een afgesproken ruil
  // ------------------------------------------------------------------
  function dienstVol(datum, deel, locatie) {
    const info = dagInfo(datum);
    return longDate(datum) + ", " + (DEEL[deel] || deel).toLowerCase() + ", " + (locatie === "VU" ? "VUmc" : "AMC") + (info.feest ? " (" + info.feest + ")" : "");
  }
  function mailUrl(a, r) {
    const rm = cfg.ROOSTERMAKER || "Danny";
    const ruil = r.soort === "ruilen";
    const onderwerp = (ruil ? "Dienstruil: " : "Dienst overnemen: ") + a.naam + (ruil ? " ⇄ " : " → ") + r.naam + " (" + medDate(a.datum) + ")";
    const regels = [
      "Hoi " + rm + ",",
      "",
      ruil ? "Wij willen graag de volgende diensten ruilen:" : "Wij willen graag de volgende dienst ruilen:",
      "",
      "• " + dienstVol(a.datum, a.deel, a.locatie),
      "   van " + a.naam + " → naar " + r.naam,
    ];
    if (ruil) regels.push("", "• " + dienstVol(r.ruil_datum, r.ruil_deel, r.ruil_locatie), "   van " + r.naam + " → naar " + a.naam);
    regels.push(
      "",
      "We zijn het hier allebei over eens. Kun je laten weten of dit rooster-technisch kan en de " + (ruil ? "ruil" : "overname") + " verwerken in het rooster?",
      "",
      "Alvast bedankt!",
      a.naam + " en " + r.naam,
      "",
      "(Verstuurd via Dienstruil: " + aanbodLink(a.id) + ")"
    );
    return "mailto:" + String(cfg.ROOSTER_EMAIL || "").trim() +
      "?subject=" + encodeURIComponent(onderwerp) + "&body=" + encodeURIComponent(regels.join("\r\n"));
  }
  const MAIL_ICOON = `<svg class="wa-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></svg>`;
  const WA_ICOON = `<svg class="wa-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4A8.5 8.5 0 1 1 20 11.5z"/><path d="M9 8.6c.3 2.9 2.4 5.4 5.6 6.3l1-1.3-1.9-1-.8.8c-1-.5-1.8-1.3-2.3-2.3l.8-.8-1-1.9z"/></svg>`;

  function deelModal(a) {
    const m = openModal(sheetHead("Aanbod geplaatst ✓") + `
      <p style="margin:0 0 14px">Je aanbod staat online. Laat het de groep weten, dan zien je collega's het meteen.</p>
      <div class="wa-preview">${esc(deelTekst(a)).replace(/\*([^*\n]+)\*/g, "<b>$1</b>")}</div>
      <a class="btn btn-wa btn-block" href="${esc(waUrl(a))}" target="_blank" rel="noopener" data-deel>${WA_ICOON} Deel in WhatsApp-groep</a>
      <div class="actions" style="margin-top:8px">
        <button type="button" class="btn btn-ghost" data-kopieer>Tekst kopiëren</button>
        <button type="button" class="btn btn-ghost" data-close>Niet nu</button>
      </div>`);
    m.el.querySelector("[data-deel]").addEventListener("click", () => setTimeout(m.close, 300));
    m.el.querySelector("[data-kopieer]").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(deelTekst(a)); toast("Tekst gekopieerd"); }
      catch (e) { toast("Kopiëren lukt niet op dit apparaat"); }
    });
  }

  async function laden(stil) {
    try {
      state.aanbod = (await rpc("dr_overzicht", metGroep({}))) || [];
      state.geladen = true;
      renderBoard();
      if (state.startAanbod) {
        const id = state.startAanbod;
        state.startAanbod = null;
        if (state.aanbod.some((a) => a.id === id)) openDetail(id);
        else { wisHash(); toast("Dit aanbod bestaat niet meer."); }
      }
    } catch (e) {
      if (e.groep) return uitloggen("Het groepswachtwoord klopt niet (meer). Log opnieuw in.");
      if (!stil) toast(e.message);
    }
  }

  // ------------------------------------------------------------------
  // UI-hulpjes
  // ------------------------------------------------------------------
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function openModal(html, opts) {
    opts = opts || {};
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    const sheet = overlay.firstElementChild;
    const vorigeFocus = document.activeElement;
    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      if (!modalRoot.children.length) document.body.style.overflow = "";
      if (vorigeFocus && vorigeFocus.focus) vorigeFocus.focus({ preventScroll: true });
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape" && modalRoot.lastElementChild === overlay) close(); }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
    document.addEventListener("keydown", onKey);
    modalRoot.appendChild(overlay);
    document.body.style.overflow = "hidden";
    return { el: sheet, close };
  }

  function sheetHead(titel) {
    return `<div class="sheet-head"><h2>${titel}</h2><button class="close" data-close aria-label="Sluiten">×</button></div>`;
  }

  function knopBezig(btn, bezig, tekst) {
    if (bezig) { btn.dataset.tekst = btn.textContent; btn.textContent = tekst || "Bezig…"; btn.disabled = true; }
    else { btn.textContent = btn.dataset.tekst || btn.textContent; btn.disabled = false; }
  }

  /* Vraagt de pincode van de aanbieder (of beheercode) en voert de actie uit.
     Bij een fout blijft het venster open met een melding. */
  function vraagPin(o) {
    const m = openModal(
      sheetHead(esc(o.titel)) +
      (o.uitleg ? `<p class="hint" style="margin-top:0">${o.uitleg}</p>` : "") +
      `<form novalidate>
        <div data-err></div>
        ${o.bevestiging ? `<label class="check"><input type="checkbox" name="ok"><span>${o.bevestiging}</span></label>` : ""}
        <div class="field">
          <label for="pin-in">Pincode van ${esc(o.naam)}</label>
          <input id="pin-in" class="input" name="pin" type="password" inputmode="numeric" autocomplete="off" required>
          <span class="hint">Pincode kwijt? De beheerder kan dit met de beheercode doen.</span>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Annuleren</button>
          <button type="submit" class="btn ${o.gevaarlijk ? "btn-danger" : "btn-primary"}">${esc(o.knop)}</button>
        </div>
      </form>`
    );
    const form = m.el.querySelector("form");
    const errBox = m.el.querySelector("[data-err]");
    const submit = form.querySelector("[type=submit]");
    setTimeout(() => form.pin.focus(), 50);
    function fout(t) { errBox.innerHTML = `<div class="error">${esc(t)}</div>`; }
    if (form.ok) form.ok.addEventListener("change", () => { submit.disabled = !form.ok.checked; });
    if (form.ok) submit.disabled = true;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.ok && !form.ok.checked) return fout("Vink eerst de bevestiging aan.");
      const pin = form.pin.value.trim();
      if (!pin) return fout("Vul de pincode in.");
      knopBezig(submit, true);
      try {
        await o.actie(pin, form.ok ? form.ok.checked : undefined);
        m.close();
        if (o.klaar) o.klaar();
      } catch (err) {
        knopBezig(submit, false);
        fout(err.message);
        form.pin.select();
      }
    });
  }

  // ------------------------------------------------------------------
  // Kalender (gedeeld door overzicht en datumkiezer)
  // ------------------------------------------------------------------
  function renderKalender(el, o) {
    const maand = o.maand;
    const eerste = startOfMonth(maand);
    const start = addDays(eerste, -((eerste.getDay() + 6) % 7)); // maandag
    const vandaag = todayIso();
    const volgende = new Date(maand.getFullYear(), maand.getMonth() + 1, 1);
    const min = o.min ? startOfMonth(parseIso(o.min)) : null;
    const magTerug = !min || eerste > min;
    let cellen = "";
    let d = start;
    while (d < volgende || (d.getDay() !== 1)) {
      const s = iso(d);
      const info = dagInfo(s);
      const ander = d.getMonth() !== maand.getMonth();
      const verleden = s < vandaag;
      const uit = (o.min && s < o.min) || ander;
      const dots = !ander && o.dots ? o.dots(s) : [];
      const klassen = ["cal-day",
        info.weekend ? "weekend" : "", info.feest ? "feestdag" : "",
        s === vandaag ? "today" : "", ander ? "other" : "", verleden ? "past" : "",
        s === o.geselecteerd ? "selected" : ""].join(" ");
      const label = longDate(s) + (info.feest ? ", " + info.feest : "") + (dots.length ? ", " + dots.length + " aanbod" : "");
      cellen += `<button type="button" class="${klassen}" data-dag="${s}" ${uit ? "disabled" : ""} aria-label="${esc(label)}" ${s === o.geselecteerd ? 'aria-pressed="true"' : ""}>
        <span class="n">${d.getDate()}</span>
        ${dots.length ? `<span class="dots">${dots.slice(0, 6).map((st) => `<span class="dot s-${st}"></span>`).join("")}</span>` : ""}
      </button>`;
      d = addDays(d, 1);
    }
    const wd = ["ma", "di", "wo", "do", "vr", "za", "zo"].map((w) => `<div class="cal-wd">${w}</div>`).join("");
    el.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" aria-label="Vorige maand" ${magTerug ? "" : "disabled"}>‹</button>
        <h3>${esc(fmtMonthYear.format(maand))}</h3>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Volgende maand">›</button>
      </div>
      <div class="cal-grid">${wd}${cellen}</div>
      ${o.legenda ? o.legenda : ""}`;
    el.onclick = (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav && !nav.disabled) return o.opMaand(new Date(maand.getFullYear(), maand.getMonth() + Number(nav.dataset.nav), 1));
      const dag = e.target.closest("[data-dag]");
      if (dag && !dag.disabled) o.opDag(dag.dataset.dag);
    };
  }

  /* Datum + dag/avond + locatie kiezen. Doordeweeks (geen feestdag) altijd avond. */
  function DienstKiezer(root, titel, startDatum) {
    const s = { datum: null, deel: null, locatie: null, maand: startOfMonth(new Date()) };
    if (startDatum && startDatum >= todayIso()) {
      s.datum = startDatum;
      s.maand = startOfMonth(parseIso(startDatum));
      s.deel = dagInfo(startDatum).keuze ? null : "avond";
    }
    function render() {
      const info = s.datum ? dagInfo(s.datum) : null;
      root.innerHTML = `
        <div class="field">
          <span class="label">${esc(titel)}</span>
          <div class="cal" data-cal></div>
        </div>
        ${s.datum ? `
          <div class="field">
            <div class="picked"><span>${esc(longDate(s.datum))}</span>${info.feest ? `<span class="tag feest">${esc(info.feest)}</span>` : info.weekend ? `<span class="tag feest">Weekend</span>` : ""}</div>
          </div>
          <div class="field">
            <span class="label">Dienst</span>
            ${info.keuze ? `
              <div class="choices">
                <button type="button" class="choice" data-deel="dag" aria-pressed="${s.deel === "dag"}">Dag</button>
                <button type="button" class="choice" data-deel="avond" aria-pressed="${s.deel === "avond"}">Avond</button>
              </div>` : `<div class="fixed-value">Avonddienst <span class="hint">(doordeweeks altijd avond)</span></div>`}
          </div>
          <div class="field">
            <span class="label">Locatie</span>
            <div class="choices">
              <button type="button" class="choice" data-loc="AMC" aria-pressed="${s.locatie === "AMC"}">AMC</button>
              <button type="button" class="choice" data-loc="VU" aria-pressed="${s.locatie === "VU"}">VUmc</button>
            </div>
          </div>` : `<p class="hint" style="margin-top:-6px">Tik op een datum. Weekenden en feestdagen zijn gekleurd.</p>`}`;
      renderKalender(root.querySelector("[data-cal]"), {
        maand: s.maand, min: todayIso(), geselecteerd: s.datum,
        opMaand: (m) => { s.maand = m; render(); },
        opDag: (d) => {
          const nieuw = dagInfo(d);
          if (!nieuw.keuze) s.deel = "avond";
          else if (!s.datum || !dagInfo(s.datum).keuze) s.deel = null;
          s.datum = d;
          render();
        },
      });
      root.querySelectorAll("[data-deel]").forEach((b) => b.addEventListener("click", () => { s.deel = b.dataset.deel; render(); }));
      root.querySelectorAll("[data-loc]").forEach((b) => b.addEventListener("click", () => { s.locatie = b.dataset.loc; render(); }));
    }
    render();
    return {
      waarde: () => ({ datum: s.datum, deel: s.deel, locatie: s.locatie }),
      fout: () => !s.datum ? "Kies een datum." : !s.deel ? "Kies dag of avond." : !s.locatie ? "Kies AMC of VUmc." : null,
    };
  }

  // ------------------------------------------------------------------
  // Schermen
  // ------------------------------------------------------------------
  function renderSetup() {
    btnNieuw.hidden = true;
    app.innerHTML = `<div class="setup">
      <h2>Nog niet gekoppeld</h2>
      <p>Deze site is nog niet verbonden met een database. Vul <code>SUPABASE_URL</code> en
      <code>SUPABASE_ANON_KEY</code> in <code>docs/config.js</code> in. De stappen staan in de README.</p>
    </div>`;
  }

  function renderLogin(melding) {
    btnNieuw.hidden = true;
    app.innerHTML = `<form class="login" novalidate>
      <h2>Welkom</h2>
      <p>Vul het groepswachtwoord in. Je vindt het in de beschrijving van de WhatsApp-groep. Je telefoon onthoudt het.</p>
      <div data-err>${melding ? `<div class="error">${esc(melding)}</div>` : ""}</div>
      <div class="field">
        <label for="groep-in">Groepswachtwoord</label>
        <input id="groep-in" class="input" name="groep" type="password" autocomplete="current-password" required>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Inloggen</button>
    </form>`;
    const form = app.querySelector("form");
    const btn = form.querySelector("button");
    form.groep.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = form.groep.value;
      if (!pw) return;
      knopBezig(btn, true, "Controleren…");
      try {
        await rpc("dr_inloggen", { p_groep: pw });
        state.groep = pw;
        store.set("dr_groep", pw);
        app.innerHTML = `<p class="loading">Laden…</p>`;
        await laden();
      } catch (err) {
        knopBezig(btn, false);
        form.querySelector("[data-err]").innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    });
  }

  function uitloggen(melding) {
    state.groep = null;
    store.set("dr_groep", null);
    modalRoot.innerHTML = "";
    document.body.style.overflow = "";
    renderLogin(melding);
  }

  function isVerlopen(a) { return a.datum < todayIso(); }

  function gefilterd(opties) {
    opties = opties || {};
    return state.aanbod.filter((a) =>
      (state.locatie === "alle" || a.locatie === state.locatie) &&
      (opties.negeerStatus || state.status === "alle" || a.status === state.status) &&
      (opties.negeerVerlopen || state.verlopen || !isVerlopen(a))
    );
  }

  function kaart(a) {
    const d = parseIso(a.datum);
    const voorstellen = a.reacties.filter((r) => r.soort !== "kan_niet" && r.status === "voorgesteld").length;
    const kanNiet = a.reacties.filter((r) => r.soort === "kan_niet").length;
    const geacc = a.reacties.find((r) => r.status === "geaccepteerd");
    let meta = [];
    if (a.status === "open") {
      if (voorstellen) meta.push(`${voorstellen} voorstel${voorstellen > 1 ? "len" : ""}`);
      if (kanNiet) meta.push(`${kanNiet}× kan niet`);
      if (!meta.length) meta.push("Nog geen reacties");
    } else if (geacc) {
      meta.push(`Met ${esc(geacc.naam)}` + (geacc.soort === "ruilen" ? ` ⇄ ${esc(dienstTekst(geacc.ruil_datum, geacc.ruil_deel, geacc.ruil_locatie))}` : " (overname)"));
      if (a.status === "afgesproken") meta.push(`wacht op akkoord ${ROOSTER}`);
    } else if (a.status === "afgehandeld") {
      meta.push(`Akkoord van ${ROOSTER}`);
    }
    return `<button type="button" class="card s-${a.status}" data-open="${a.id}">
      <div class="datebox"><span class="wd">${esc(fmtWd.format(d).replace(".", ""))}</span><span class="d">${d.getDate()}</span><span class="m">${esc(fmtMonShort.format(d).replace(".", ""))}</span></div>
      <div class="card-body">
        <div class="card-top"><div class="tags">${dienstTags(a.datum, a.deel, a.locatie)}</div><span class="pill s-${a.status}">${STATUS[a.status]}</span></div>
        <div class="who">Aangeboden door <strong>${esc(a.naam)}</strong></div>
        ${a.notitie ? `<div class="note">${esc(a.notitie)}</div>` : ""}
        <div class="meta">${meta.join(" · ")}</div>
      </div>
    </button>`;
  }

  function lijstHtml(items) {
    if (!items.length) {
      return `<div class="empty"><strong>Niets gevonden</strong>${state.aanbod.length ? "Pas de filters aan, of" : "Er staat nog niets op het bord."} bied zelf een dienst aan.</div>`;
    }
    let html = "", maand = "";
    items.forEach((a) => {
      const m = fmtMonthYear.format(parseIso(a.datum));
      if (m !== maand) { maand = m; html += `<div class="month-heading">${esc(m)}</div>`; }
      html += kaart(a);
    });
    return `<div class="list">${html}</div>`;
  }

  function renderBoard() {
    if (!state.groep) return;
    btnNieuw.hidden = false;
    const basis = gefilterd({ negeerStatus: true });
    const tel = { alle: basis.length, open: 0, afgesproken: 0, afgehandeld: 0 };
    basis.forEach((a) => tel[a.status]++);
    const chip = (groep, waarde, label, count) =>
      `<button type="button" class="chip" data-${groep}="${waarde}" aria-pressed="${state[groep] === waarde}">${label}${count != null ? ` <span class="count">${count}</span>` : ""}</button>`;

    let inhoud;
    if (state.view === "lijst") {
      const items = gefilterd().slice().sort((x, y) => x.datum.localeCompare(y.datum) || x.aangemaakt.localeCompare(y.aangemaakt));
      inhoud = lijstHtml(items);
    } else {
      inhoud = `<div class="cal" id="board-cal"></div><div class="cal-daylist" id="board-daylist"></div>`;
    }

    app.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-row">
          <div class="segmented" role="group" aria-label="Weergave">
            <button type="button" data-view="lijst" aria-pressed="${state.view === "lijst"}">Lijst</button>
            <button type="button" data-view="kalender" aria-pressed="${state.view === "kalender"}">Kalender</button>
          </div>
          <div class="chips" role="group" aria-label="Locatie">
            ${chip("locatie", "alle", "Alle")}${chip("locatie", "AMC", "AMC")}${chip("locatie", "VU", "VUmc")}
          </div>
        </div>
        <div class="toolbar-row">
          <div class="chips" role="group" aria-label="Status">
            ${chip("status", "alle", "Alles", tel.alle)}${chip("status", "open", "Open", tel.open)}${chip("status", "afgesproken", "Afgesproken", tel.afgesproken)}${chip("status", "afgehandeld", "Afgehandeld", tel.afgehandeld)}
          </div>
          ${state.view === "lijst" ? `<label class="toggle"><input type="checkbox" data-verlopen ${state.verlopen ? "checked" : ""}> Toon verlopen</label>` : ""}
        </div>
      </div>
      <div class="status-uitleg">
        ${["open", "afgesproken", "afgehandeld"].map((k) => `<div><span class="pill s-${k}">${STATUS[k]}</span><span>${STATUS_UITLEG[k]}</span></div>`).join("")}
      </div>
      ${inhoud}
      <div class="footer">
        <button type="button" class="link-btn" data-ververs>Vernieuwen</button>
        <button type="button" class="link-btn" data-uitloggen>Uitloggen</button>
      </div>`;

    if (state.view === "kalender") tekenBordKalender();
  }

  function tekenBordKalender() {
    const items = gefilterd({ negeerVerlopen: true });
    const perDag = {};
    items.forEach((a) => { (perDag[a.datum] = perDag[a.datum] || []).push(a); });
    renderKalender(document.getElementById("board-cal"), {
      maand: state.calMonth, geselecteerd: state.calSelected,
      dots: (s) => (perDag[s] || []).map((a) => a.status),
      legenda: `<div class="legend"><span><i class="dot s-open"></i>Open</span><span><i class="dot s-afgesproken"></i>Afgesproken</span><span><i class="dot s-afgehandeld"></i>Afgehandeld</span><span><i class="sw"></i>Weekend/feestdag</span></div>`,
      opMaand: (m) => { state.calMonth = m; state.calSelected = null; tekenBordKalender(); },
      opDag: (s) => { state.calSelected = s; tekenBordKalender(); },
    });
    const lijst = document.getElementById("board-daylist");
    if (!state.calSelected) {
      lijst.innerHTML = `<p class="hint" style="text-align:center">Tik op een dag om de diensten te zien.</p>`;
      return;
    }
    const dag = (perDag[state.calSelected] || []);
    lijst.innerHTML = `<h4>${esc(longDate(state.calSelected))}</h4>` + (dag.length
      ? `<div class="list">${dag.map(kaart).join("")}</div>`
      : `<div class="empty">Geen diensten aangeboden op deze dag.<br><button type="button" class="btn btn-primary btn-sm" style="margin-top:10px" data-nieuw-op="${state.calSelected}">Dienst op deze dag aanbieden</button></div>`);
  }

  // Event delegation voor het bord
  app.addEventListener("click", (e) => {
    const t = e.target;
    const v = t.closest("[data-view]");
    if (v) { state.view = v.dataset.view; store.set("dr_view", state.view); return renderBoard(); }
    const st = t.closest("[data-status]");
    if (st) { state.status = st.dataset.status; return renderBoard(); }
    const lo = t.closest("[data-locatie]");
    if (lo) { state.locatie = lo.dataset.locatie; return renderBoard(); }
    const op = t.closest("[data-open]");
    if (op) return openDetail(op.dataset.open);
    if (t.closest("[data-ververs]")) { laden().then(() => toast("Bijgewerkt")); return; }
    if (t.closest("[data-uitloggen]")) return uitloggen();
    const no = t.closest("[data-nieuw-op]");
    if (no) return nieuwAanbod(no.dataset.nieuwOp);
  });
  app.addEventListener("change", (e) => {
    if (e.target.matches("[data-verlopen]")) { state.verlopen = e.target.checked; renderBoard(); }
  });
  btnNieuw.addEventListener("click", () => nieuwAanbod(state.view === "kalender" ? state.calSelected : null));

  // ------------------------------------------------------------------
  // Nieuw aanbod
  // ------------------------------------------------------------------
  function nieuwAanbod(startDatum) {
    const m = openModal(sheetHead("Dienst aanbieden") + `
      <form novalidate>
        <div data-kiezer></div>
        <div class="field">
          <label for="na-naam">Je naam</label>
          <input id="na-naam" class="input" name="naam" maxlength="60" autocomplete="name" value="${esc(state.naam)}" required>
        </div>
        <div class="field">
          <label for="na-pin">Kies een pincode (4–8 cijfers)</label>
          <input id="na-pin" class="input" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" required>
          <span class="hint">Alleen met deze pincode kun jij voorstellen accepteren en de dienst als afgehandeld markeren. Onthoud hem goed.</span>
        </div>
        <div class="field">
          <label for="na-notitie">Toelichting <span class="hint">(optioneel)</span></label>
          <textarea id="na-notitie" class="input" name="notitie" maxlength="300" placeholder="Bijv. liefst ruilen tegen een weekend in oktober"></textarea>
        </div>
        <div data-err></div>
        <button class="btn btn-primary btn-block" type="submit">Aanbod plaatsen</button>
      </form>`);
    const form = m.el.querySelector("form");
    const kiezer = DienstKiezer(m.el.querySelector("[data-kiezer]"), "Welke dienst wil je kwijt?", startDatum);
    const err = m.el.querySelector("[data-err]");
    const btn = form.querySelector("[type=submit]");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const w = kiezer.waarde();
      const naam = form.naam.value.trim();
      const pin = form.pin.value.trim();
      const f = kiezer.fout() || (!naam ? "Vul je naam in." : !/^[0-9]{4,8}$/.test(pin) ? "Pincode moet 4 tot 8 cijfers zijn." : null);
      if (f) { err.innerHTML = `<div class="error">${esc(f)}</div>`; return; }
      knopBezig(btn, true, "Plaatsen…");
      try {
        const nieuwId = await rpc("dr_aanbod_plaatsen", metGroep({
          p_datum: w.datum, p_deel: w.deel, p_locatie: w.locatie,
          p_naam: naam, p_pin: pin, p_notitie: form.notitie.value.trim() || null,
        }));
        state.naam = naam; store.set("dr_naam", naam);
        m.close();
        state.status = "alle";
        await laden(true);
        const nieuw = state.aanbod.find((a) => a.id === nieuwId);
        if (nieuw) deelModal(nieuw); else toast("Aanbod geplaatst");
      } catch (ex) {
        knopBezig(btn, false);
        if (ex.groep) return uitloggen(ex.message);
        err.innerHTML = `<div class="error">${esc(ex.message)}</div>`;
      }
    });
  }

  // ------------------------------------------------------------------
  // Detail van een aanbod
  // ------------------------------------------------------------------
  function openDetail(id) {
    zetHash(id);
    const m = openModal(`<div data-inhoud></div>`, { onClose: wisHash });
    const root = m.el.querySelector("[data-inhoud]");
    const form = { soort: null, kiezer: null, ruilWijze: null };

    async function naActie(melding) {
      toast(melding);
      await laden(true);
      teken();
    }

    function teken() {
      const a = state.aanbod.find((x) => x.id === id);
      if (!a) { root.innerHTML = sheetHead("Niet gevonden") + `<p>Dit aanbod bestaat niet meer.</p>`; return; }
      const verlopen = isVerlopen(a);
      const voorstellen = a.reacties.filter((r) => r.soort !== "kan_niet");
      const kanNiet = a.reacties.filter((r) => r.soort === "kan_niet");
      const geacc = a.reacties.find((r) => r.status === "geaccepteerd");
      const RS = { voorgesteld: "Voorstel", geaccepteerd: "Geaccepteerd", geweigerd: "Geweigerd", vervallen: "Vervallen" };

      let banner = "";
      if (a.status === "afgesproken" && geacc) {
        banner = `<div class="banner s-afgesproken"><strong>Afgesproken met ${esc(geacc.naam)}</strong>
          ${geacc.soort === "ruilen" ? `Ruil tegen ${esc(dienstTekst(geacc.ruil_datum, geacc.ruil_deel, geacc.ruil_locatie))}.` : "Neemt de dienst over (zonder terugdienst)."}
          <br><br><strong>Volgende stap:</strong> mail ${ROOSTER} van het rooster. De mail staat al klaar, inclusief alle gegevens van de ruil. Zodra ${ROOSTER} akkoord geeft en de ruil heeft verwerkt in het rooster, zet ${esc(a.naam)} de dienst op <em>Afgehandeld</em>.
          <a class="btn btn-primary btn-block" style="margin-top:12px" href="${esc(mailUrl(a, geacc))}" data-mail>${MAIL_ICOON} Mail ${ROOSTER}</a></div>`;
      } else if (a.status === "afgehandeld") {
        banner = `<div class="banner s-afgehandeld"><strong>✓ Afgehandeld${a.afgehandeld_op ? " op " + esc(fmtStamp.format(new Date(a.afgehandeld_op))) : ""}</strong>
          ${geacc ? `${geacc.soort === "ruilen" ? `Geruild met ${esc(geacc.naam)} tegen ${esc(dienstTekst(geacc.ruil_datum, geacc.ruil_deel, geacc.ruil_locatie))}` : `Overgenomen door ${esc(geacc.naam)}`}. ` : ""}${ROOSTER} heeft akkoord gegeven en de ruil verwerkt in het rooster.</div>`;
      }

      const voorstelHtml = voorstellen.map((r) => `
        <div class="resp r-${r.status}">
          <div class="resp-top"><span class="resp-name">${esc(r.naam)}</span><span class="resp-status">${RS[r.status]}</span></div>
          <div class="resp-what">${r.soort === "ruilen"
            ? (r.ruil_datum
              ? `Wil ruilen tegen <strong>${esc(dienstTekst(r.ruil_datum, r.ruil_deel, r.ruil_locatie))}</strong>${dagInfo(r.ruil_datum).feest ? ` (${esc(dagInfo(r.ruil_datum).feest)})` : ""}`
              : `Wil ruilen: <strong>${esc(a.naam)} kiest</strong> zelf een dienst van ${esc(r.naam)} uit het rooster`)
            : `Neemt de dienst <strong>over</strong> zonder terugdienst`}</div>
          ${r.notitie ? `<div class="note" style="margin-top:4px">${esc(r.notitie)}</div>` : ""}
          <div class="hint">${esc(fmtStamp.format(new Date(r.aangemaakt)))}</div>
          ${a.status === "open" && r.status === "voorgesteld" ? `
            <div class="actions">
              <button type="button" class="btn btn-ok btn-sm" data-accept="${r.id}">Accepteren</button>
              <button type="button" class="btn btn-ghost btn-sm" data-weiger="${r.id}">Weigeren</button>
            </div>` : ""}
        </div>`).join("");

      const reageren = a.status === "open" && !verlopen ? `
        <div class="section">
          <h3>Reageren</h3>
          <form data-reageer novalidate>
            <div class="field">
              <label for="r-naam">Je naam</label>
              <input id="r-naam" class="input" name="naam" maxlength="60" autocomplete="name" value="${esc(state.naam)}">
            </div>
            <div class="field">
              <span class="label">Wat wil je doen?</span>
              <div class="choices">
                <button type="button" class="choice" data-soort="overnemen" aria-pressed="${form.soort === "overnemen"}">Overnemen<small>zonder terugdienst</small></button>
                <button type="button" class="choice" data-soort="ruilen" aria-pressed="${form.soort === "ruilen"}">Ruilen<small>tegen een dienst van jou</small></button>
                <button type="button" class="choice" data-soort="kan_niet" aria-pressed="${form.soort === "kan_niet"}">Kan niet<small>laat het weten</small></button>
              </div>
            </div>
            <div data-ruil ${form.soort === "ruilen" ? "" : "hidden"}></div>
            <div class="field" ${form.soort && form.soort !== "kan_niet" ? "" : "hidden"}>
              <label for="r-notitie">Bericht <span class="hint">(optioneel)</span></label>
              <textarea id="r-notitie" class="input" name="notitie" maxlength="300"></textarea>
            </div>
            <div data-err></div>
            <button type="submit" class="btn btn-primary btn-block" ${form.soort ? "" : "disabled"}>${
              form.soort === "ruilen" ? "Ruilvoorstel versturen" : form.soort === "kan_niet" ? "Laat weten dat ik niet kan" : form.soort === "overnemen" ? "Aanbieden om over te nemen" : "Kies hierboven een optie"}</button>
          </form>
        </div>` : "";

      const kanAfhandelen = a.status !== "afgehandeld";
      const eigenaar = `
        <div class="section">
          <h3>Alleen voor ${esc(a.naam)}</h3>
          <div class="owner-box">
            <div class="hint">${a.status === "open" ? "Accepteer of weiger voorstellen hierboven. " : ""}${a.status === "afgesproken" ? `Heeft ${ROOSTER} akkoord gegeven en de ruil verwerkt in het rooster? Markeer de dienst dan als afgehandeld. ` : ""}Voor deze acties heb je je pincode nodig.</div>
            <div class="actions">
              ${kanAfhandelen ? `<button type="button" class="btn btn-primary btn-sm" data-afhandelen>✓ Markeer als afgehandeld</button>` : ""}
              ${a.status === "afgesproken" ? `<button type="button" class="btn btn-ghost btn-sm" data-annuleer>Afspraak gaat niet door</button>` : ""}
              <button type="button" class="btn btn-danger btn-sm" data-verwijder>Verwijderen</button>
            </div>
          </div>
        </div>`;

      root.innerHTML = sheetHead(esc(longDate(a.datum))) + `
        <div class="detail-tags">${dienstTags(a.datum, a.deel, a.locatie)}<span class="pill s-${a.status}">${STATUS[a.status]}</span></div>
        <div class="who">Aangeboden door <strong>${esc(a.naam)}</strong> · ${esc(fmtStamp.format(new Date(a.aangemaakt)))}</div>
        ${a.status === "open" && !verlopen ? `<a class="btn btn-wa btn-sm" style="margin-top:10px" href="${esc(waUrl(a))}" target="_blank" rel="noopener">${WA_ICOON} Deel in WhatsApp</a>` : ""}
        ${a.notitie ? `<div class="detail-note">${esc(a.notitie)}</div>` : ""}
        ${verlopen && a.status !== "afgehandeld" ? `<div class="banner s-afgesproken">Deze datum is voorbij.</div>` : ""}
        ${banner}
        <div class="section">
          <h3>Voorstellen (${voorstellen.length})</h3>
          ${voorstelHtml || `<p class="hint">Nog geen voorstellen.</p>`}
          ${kanNiet.length ? `<div class="kannet">Kan niet: ${kanNiet.map((r) => `<span class="tag">${esc(r.naam)}</span>`).join("")}</div>` : ""}
        </div>
        ${reageren}
        ${eigenaar}`;

      bind(a);
    }

    // Ruil zonder datum: aanbieder kiest eerst welke dienst hij/zij overneemt.
    function kiesTerugdienst(a, r) {
      const k = openModal(sheetHead("Welke dienst neem je over?") + `
        <p class="hint" style="margin-top:0">Kijk in het rooster welke dienst van <strong>${esc(r.naam)}</strong> je wilt overnemen. Die komt ook in de mail aan ${ROOSTER}.</p>
        <div data-k></div>
        <div data-err></div>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Annuleren</button>
          <button type="button" class="btn btn-primary" data-verder>Verder</button>
        </div>`);
      const kiezer = DienstKiezer(k.el.querySelector("[data-k]"), "Dienst van " + r.naam);
      k.el.querySelector("[data-k]").addEventListener("click", () => { k.el.querySelector("[data-err]").innerHTML = ""; });
      k.el.querySelector("[data-verder]").addEventListener("click", () => {
        const f = kiezer.fout();
        if (f) { k.el.querySelector("[data-err]").innerHTML = `<div class="error">${esc(f)}</div>`; return; }
        const w = kiezer.waarde();
        k.close();
        vraagPin({
          titel: "Voorstel accepteren",
          naam: a.naam,
          uitleg: `Je ruilt met <strong>${esc(r.naam)}</strong> en neemt over: <strong>${esc(dienstTekst(w.datum, w.deel, w.locatie))}</strong>. Andere voorstellen vervallen en het aanbod staat op <strong>Afgesproken</strong>. Mail daarna ${ROOSTER} van het rooster.`,
          knop: "Accepteren",
          actie: (pin) => rpc("dr_beslissen", metGroep({
            p_reactie: r.id, p_pin: pin, p_accepteren: true,
            p_ruil_datum: w.datum, p_ruil_deel: w.deel, p_ruil_locatie: w.locatie,
          })),
          klaar: () => naActie(`Afgesproken! Mail nu ${cfg.ROOSTERMAKER || "Danny"} van het rooster.`),
        });
      });
    }

    function bind(a) {
      root.querySelectorAll("[data-accept],[data-weiger]").forEach((b) => b.addEventListener("click", () => {
        const accept = !!b.dataset.accept;
        const rid = b.dataset.accept || b.dataset.weiger;
        const r = a.reacties.find((x) => x.id === rid);
        if (accept && r.soort === "ruilen" && !r.ruil_datum) return kiesTerugdienst(a, r);
        vraagPin({
          titel: accept ? "Voorstel accepteren" : "Voorstel weigeren",
          naam: a.naam,
          uitleg: accept
            ? `Je accepteert het voorstel van <strong>${esc(r.naam)}</strong>. Andere voorstellen vervallen en het aanbod staat op <strong>Afgesproken</strong>. Mail daarna samen ${ROOSTER} van het rooster.`
            : `Je weigert het voorstel van <strong>${esc(r.naam)}</strong>.`,
          knop: accept ? "Accepteren" : "Weigeren",
          actie: (pin) => rpc("dr_beslissen", metGroep({ p_reactie: rid, p_pin: pin, p_accepteren: accept })),
          klaar: () => naActie(accept ? `Afgesproken! Mail nu ${cfg.ROOSTERMAKER || "Danny"} van het rooster.` : "Voorstel geweigerd"),
        });
      }));

      const afh = root.querySelector("[data-afhandelen]");
      if (afh) afh.addEventListener("click", () => vraagPin({
        titel: "Markeer als afgehandeld",
        naam: a.naam,
        uitleg: (a.status === "open" ? "Er is op de site nog geen voorstel geaccepteerd. " : "") + `Doe dit pas als ${ROOSTER} akkoord heeft gegeven en de ruil heeft verwerkt in het rooster.`,
        bevestiging: `${ROOSTER} heeft akkoord gegeven en de ruil verwerkt in het rooster.`,
        knop: "Afhandelen",
        actie: (pin, ok) => rpc("dr_afhandelen", metGroep({ p_aanbod: a.id, p_pin: pin, p_bevestigd: !!ok })),
        klaar: () => naActie("Afgehandeld ✓"),
      }));

      const ann = root.querySelector("[data-annuleer]");
      if (ann) ann.addEventListener("click", () => vraagPin({
        titel: "Afspraak gaat niet door",
        naam: a.naam,
        uitleg: "Het aanbod gaat weer open. Het geaccepteerde voorstel wordt geweigerd; vervallen voorstellen worden weer actief.",
        knop: "Weer openzetten",
        actie: (pin) => rpc("dr_afspraak_annuleren", metGroep({ p_aanbod: a.id, p_pin: pin })),
        klaar: () => naActie("Aanbod staat weer open"),
      }));

      root.querySelector("[data-verwijder]").addEventListener("click", () => vraagPin({
        titel: "Aanbod verwijderen",
        naam: a.naam,
        uitleg: "Het aanbod en alle reacties worden definitief verwijderd. Gebruik liever ‘afgehandeld’ als de dienst geruild is.",
        knop: "Verwijderen",
        gevaarlijk: true,
        actie: (pin) => rpc("dr_verwijderen", metGroep({ p_aanbod: a.id, p_pin: pin })),
        klaar: async () => { m.close(); toast("Aanbod verwijderd"); await laden(true); },
      }));

      const rf = root.querySelector("[data-reageer]");
      if (!rf) return;
      const ruilBox = rf.querySelector("[data-ruil]");
      function tekenRuil() {
        ruilBox.innerHTML = `
          <div class="field">
            <span class="label">Hoe wil je ruilen?</span>
            <div class="choices">
              <button type="button" class="choice" data-wijze="datum" aria-pressed="${form.ruilWijze === "datum"}">Ik stel een datum voor<small>een dienst van mij</small></button>
              <button type="button" class="choice" data-wijze="kiezen" aria-pressed="${form.ruilWijze === "kiezen"}">${esc(a.naam)} kiest<small>uit mijn diensten in het rooster</small></button>
            </div>
          </div>
          <div data-kiezerbox></div>`;
        const box = ruilBox.querySelector("[data-kiezerbox]");
        form.kiezer = null;
        if (form.ruilWijze === "datum") form.kiezer = DienstKiezer(box, "Welke dienst bied je terug?");
        else if (form.ruilWijze === "kiezen") box.innerHTML = `<p class="hint" style="margin:-4px 0 14px">${esc(a.naam)} kijkt in het rooster welke dienst van jou hij/zij wil overnemen, en kiest die bij het accepteren.</p>`;
        ruilBox.querySelectorAll("[data-wijze]").forEach((b) => b.addEventListener("click", () => { form.ruilWijze = b.dataset.wijze; tekenRuil(); }));
      }
      if (form.soort === "ruilen") tekenRuil();
      rf.querySelectorAll("[data-soort]").forEach((b) => b.addEventListener("click", () => {
        const naam = rf.naam.value;
        form.soort = b.dataset.soort;
        teken();
        const nf = root.querySelector("[data-reageer]");
        if (nf) nf.naam.value = naam;
      }));
      rf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = rf.querySelector("[data-err]");
        const btn = rf.querySelector("[type=submit]");
        const naam = rf.naam.value.trim();
        let f = !naam ? "Vul je naam in." : !form.soort ? "Kies wat je wilt doen." : null;
        if (!f && form.soort === "ruilen") f = !form.ruilWijze ? "Kies hoe je wilt ruilen." : form.kiezer ? form.kiezer.fout() : null;
        if (f) { err.innerHTML = `<div class="error">${esc(f)}</div>`; return; }
        const w = form.soort === "ruilen" && form.kiezer ? form.kiezer.waarde() : {};
        knopBezig(btn, true, "Versturen…");
        try {
          await rpc("dr_reageren", metGroep({
            p_aanbod: a.id, p_soort: form.soort, p_naam: naam,
            p_ruil_datum: w.datum || null, p_ruil_deel: w.deel || null, p_ruil_locatie: w.locatie || null,
            p_notitie: (rf.notitie && rf.notitie.value.trim()) || null,
          }));
          state.naam = naam; store.set("dr_naam", naam);
          const soort = form.soort;
          form.soort = null; form.kiezer = null; form.ruilWijze = null;
          await naActie(soort === "kan_niet" ? "Doorgegeven dat je niet kan" : "Voorstel verstuurd naar " + a.naam);
        } catch (ex) {
          knopBezig(btn, false);
          if (ex.groep) return uitloggen(ex.message);
          err.innerHTML = `<div class="error">${esc(ex.message)}</div>`;
        }
      });
    }

    teken();
  }

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  function start() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return renderSetup();
    const stilVerversen = () => {
      if (state.groep && state.geladen && document.visibilityState === "visible" && !modalRoot.children.length) laden(true);
    };
    setInterval(stilVerversen, 60000);
    window.addEventListener("hashchange", () => {
      const id = (location.hash.match(/aanbod=([0-9a-f-]{36})/i) || [])[1];
      if (!id || !state.groep) return;
      if (!state.geladen) { state.startAanbod = id; return; }
      if (modalRoot.children.length) return;
      if (state.aanbod.some((a) => a.id === id)) openDetail(id);
    });
    document.addEventListener("visibilitychange", stilVerversen);
    if (!state.groep) return renderLogin();
    laden();
  }
  start();
})();
