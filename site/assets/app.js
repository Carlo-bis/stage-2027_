/* Stage 2027 – dashboard. JavaScript semplice, senza build e senza dipendenze (tranne la libreria docx per i file Word). */
(function () {
  "use strict";

  /* ------------------------------------------------------------ costanti */
  var STATUSES = [
    { id: "todo", label: "Da candidare" },
    { id: "applied", label: "Candidato" },
    { id: "assessment", label: "Assessment" },
    { id: "interviews", label: "Colloqui" },
    { id: "offer", label: "Offerta" },
    { id: "rejected", label: "Rifiutata" },
    { id: "withdrawn", label: "Ritirata" },
  ];
  var ACTIVE = ["todo", "applied", "assessment", "interviews", "offer"];
  var CATEGORIES = { banca: "Banca", asset_management: "Asset management", vc_pe: "VC / PE", family_office: "Family office", fintech: "Fintech", altro: "Altro" };
  var MON = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  var LOC_PRIORITY = { lugano: 0, milano: 1, svizzera: 2, sconosciuta: 3, fuori: 4 };

  /* ------------------------------------------------------------ utilità */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  var mem = {};
  var persistOk = true;
  function sget(k, d) {
    try { var v = window.localStorage.getItem("stage27." + k); return v == null ? (k in mem ? mem[k] : d) : JSON.parse(v); }
    catch (e) { return k in mem ? mem[k] : d; }
  }
  function sset(k, v) {
    mem[k] = v;
    try { window.localStorage.setItem("stage27." + k, JSON.stringify(v)); } catch (e) { persistOk = false; }
  }

  function todayUTC() { var n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
  function isoToUTC(iso) { var p = iso.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function daysLeft(iso) { return Math.round((isoToUTC(iso) - todayUTC()) / 86400000); }
  function fmtShort(iso) { var p = iso.split("-"); return +p[2] + " " + MON[+p[1] - 1]; }
  function fmtDate(iso) { var p = iso.split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0]; }
  function isoToday() { var n = new Date(); return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0"); }

  function classifyLocation(s) {
    s = String(s || "");
    if (!s.trim()) return "sconosciuta";
    if (/\b(lugano|ticino|bellinzona|locarno|chiasso|mendrisio|massagno|paradiso)\b/i.test(s)) return "lugano";
    if (/\b(milan|milano)\b/i.test(s)) return "milano";
    if (/\b(switzerland|svizzera|schweiz|suisse|zurich|zürich|zurigo|geneva|ginevra|genève|basel|basilea|bern|berna|lausanne|zug|baar)\b/i.test(s)) return "svizzera";
    return "fuori";
  }

  /* ------------------------------------------------------------ stato */
  var S = {
    data: null,
    loadError: "",
    apps: sget("apps", {}),
    manual: sget("manual", []),
    profile: sget("profile", null),
    checks: sget("checks", {}),
    prefs: Object.assign({ loc: "tutte", finance: true, check: true, excluded: false, q: "", sort: "scadenza", lang: "en", profileLine: true }, sget("prefs", {})),
    view: "offerte",
    openId: null,
    lastTrigger: null,
  };
  function savePrefs() { sset("prefs", S.prefs); }
  function saveApps() { sset("apps", S.apps); }

  function allOffers() { return ((S.data && S.data.offers) || []).concat(S.manual); }
  function getOffer(id) { return allOffers().filter(function (o) { return o.id === id; })[0] || null; }
  function appOf(id) { return S.apps[id] || {}; }
  function statusLabel(id) { return (STATUSES.filter(function (s) { return s.id === id; })[0] || {}).label || ""; }

  function isNew(o) {
    if (!S.data || o.origin !== "auto") return false;
    if ((S.data.new_ids || []).indexOf(o.id) !== -1) return true;
    return !!o.first_seen && Math.round((todayUTC() - isoToUTC(o.first_seen)) / 86400000) <= 3;
  }

  function durationLabel(o) {
    if (o.duration_text) return o.duration_text.replace(/^Stage di /i, "");
    var m = o.duration_months || [];
    if (!m.length) return "";
    var max = Math.max.apply(null, m);
    return max < 3 ? Math.round(max * 4.345) + " settimane" : String(max).replace(".", ",") + " mesi";
  }

  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 3600);
  }

  /* ------------------------------------------------------------ filtri */
  function visibleOffers() {
    var q = S.prefs.q.trim().toLowerCase();
    var list = allOffers().filter(function (o) {
      if (o.verdict === "check" && !S.prefs.check) return false;
      if (S.prefs.finance && o.relevance === "bassa") return false;
      var lc = o.location_class;
      if (S.prefs.loc === "lugano" && lc !== "lugano") return false;
      if (S.prefs.loc === "milano" && lc !== "milano") return false;
      if (S.prefs.loc === "svizzera" && lc !== "svizzera" && lc !== "lugano") return false;
      if (q && (o.company + " " + o.title + " " + o.location + " " + (o.summary || "")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (a, b) {
      if (S.prefs.sort === "azienda") return a.company.localeCompare(b.company);
      if (S.prefs.sort === "recenti") return (b.first_seen || "").localeCompare(a.first_seen || "");
      function key(o) {
        if (!o.deadline) return "5" + o.company;
        var d = daysLeft(o.deadline);
        return (d < 0 ? "9" : "1") + o.deadline;
      }
      var ka = key(a), kb = key(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return (LOC_PRIORITY[a.location_class] || 0) - (LOC_PRIORITY[b.location_class] || 0);
    });
    return list;
  }

  /* ------------------------------------------------------------ vista: offerte */
  function renderOfferte() {
    var v = $("#view");
    v.innerHTML =
      '<div class="page-head"><h2>Offerte di stage estivo 2027</h2><p id="summary"></p></div>' +
      '<section class="ruler-wrap" aria-labelledby="rulerTitle"><h3 id="rulerTitle">Prossime scadenze</h3>' +
      '<div class="ruler" id="ruler"></div><p class="ruler-note" id="rulerNote"></p></section>' +
      '<form class="filters" id="filters" onsubmit="return false">' +
      '<div class="seg" role="radiogroup" aria-label="Sede">' + [["tutte", "Tutte"], ["lugano", "Lugano e Ticino"], ["milano", "Milano"], ["svizzera", "Svizzera"]].map(function (x) {
        return '<label><input type="radio" name="loc" value="' + x[0] + '"' + (S.prefs.loc === x[0] ? " checked" : "") + '><span>' + x[1] + "</span></label>";
      }).join("") + "</div>" +
      '<label class="check"><input type="checkbox" id="fFinance"' + (S.prefs.finance ? " checked" : "") + '> Solo ruoli di finanza</label>' +
      '<label class="check"><input type="checkbox" id="fCheck"' + (S.prefs.check ? " checked" : "") + '> Mostra quelle da verificare</label>' +
      '<label><span class="lbl" style="display:none">Cerca</span><input class="field-search" id="fQ" type="search" placeholder="Cerca azienda o ruolo" value="' + esc(S.prefs.q) + '"></label>' +
      '<label><span class="lbl" style="display:none">Ordina</span><select id="fSort" aria-label="Ordina per">' + [["scadenza", "Ordina per scadenza"], ["recenti", "Ordina per novità"], ["azienda", "Ordina per azienda"]].map(function (x) {
        return '<option value="' + x[0] + '"' + (S.prefs.sort === x[0] ? " selected" : "") + ">" + x[1] + "</option>";
      }).join("") + "</select></label>" +
      '<span class="spacer"></span><button type="button" class="btn ghost small" data-act="add">Aggiungi un\'offerta</button></form>' +
      '<ul class="rows" id="rows"></ul><section class="excluded-wrap" id="excludedWrap"></section>';

    $$('input[name="loc"]').forEach(function (r) { r.addEventListener("change", function () { S.prefs.loc = r.value; savePrefs(); updateOfferte(); }); });
    $("#fFinance").addEventListener("change", function (e) { S.prefs.finance = e.target.checked; savePrefs(); updateOfferte(); });
    $("#fCheck").addEventListener("change", function (e) { S.prefs.check = e.target.checked; savePrefs(); updateOfferte(); });
    $("#fQ").addEventListener("input", function (e) { S.prefs.q = e.target.value; savePrefs(); updateOfferte(); });
    $("#fSort").addEventListener("change", function (e) { S.prefs.sort = e.target.value; savePrefs(); updateOfferte(); });
    updateOfferte();
  }

  function updateOfferte() {
    if (S.view !== "offerte") return;
    var list = visibleOffers();
    var all = allOffers();
    var matches = all.filter(function (o) { return o.verdict === "match" || o.verdict === "utente"; }).length;
    var checks = all.filter(function (o) { return o.verdict === "check"; }).length;
    var excl = (S.data && S.data.excluded) || [];
    var shown = list.length;
    $("#summary").textContent = all.length
      ? plural(all.length, "offerta aperta", "offerte aperte") + " (" + plural(matches, "rispetta", "rispettano") + " tutti i criteri: estate 2027, massimo 3 mesi, Svizzera o Milano" +
        (checks ? "; " + plural(checks, "va verificata", "vanno verificate") : "") + "). " + (shown !== all.length ? "Con i filtri attuali ne vedi " + shown + ". " : "") +
        (excl.length ? plural(excl.length, "offerta scartata", "offerte scartate") + "." : "")
      : "Nessuna offerta al momento.";
    renderRuler(list);
    var rows = $("#rows");
    if (!list.length) {
      rows.innerHTML = '<li class="empty">' + (all.length
        ? "<strong>Nessuna offerta con questi filtri.</strong> Prova a togliere il filtro sulla sede o sui ruoli di finanza."
        : "<strong>Nessuna offerta per ora.</strong> Lo scraper controlla le fonti ogni giorno. Intanto, nella scheda Fonti trovi le pagine da controllare a mano, e puoi aggiungere un'offerta con il pulsante in alto.") + "</li>";
    } else {
      rows.innerHTML = list.map(rowHTML).join("");
    }
    renderExcluded(excl);
  }

  function rowHTML(o) {
    var d = o.deadline ? daysLeft(o.deadline) : null;
    var cls = d == null || d < 0 ? "none" : d <= 10 ? "urgent" : d <= 30 ? "soon" : "";
    var when;
    if (d == null) when = '<span class="n" style="font-size:20px">—</span><span class="u">scadenza non indicata</span>';
    else if (d < 0) when = '<span class="n" style="font-size:18px">scaduta</span><span class="u">' + fmtShort(o.deadline) + "</span>";
    else if (d === 0) when = '<span class="n" style="font-size:20px">oggi</span><span class="u">' + fmtShort(o.deadline) + "</span>";
    else when = '<span class="n">' + d + '</span><span class="u">' + (d === 1 ? "giorno" : "giorni") + " · " + fmtShort(o.deadline) + "</span>";
    var tags = [];
    if (isNew(o)) tags.push('<span class="tag new">Nuova</span>');
    if (o.verdict === "check") tags.push('<span class="tag warn">Da verificare: ' + esc((o.reasons || []).join(", ")) + "</span>");
    if (/non confermat/i.test(o.confidence || "")) tags.push('<span class="tag warn">Dati non confermati sul sito ufficiale</span>');
    if (o.origin === "manuale") tags.push('<span class="tag dim">Trovata a mano</span>');
    if (o.origin === "utente") tags.push('<span class="tag dim">Aggiunta da te</span>');
    var a = appOf(o.id);
    var dur = durationLabel(o);
    return '<li><button type="button" class="row" data-open="' + esc(o.id) + '">' +
      '<span class="when ' + cls + '">' + when + "</span>" +
      '<span class="what"><span class="co">' + esc(o.company) + '</span><span class="ti">' + esc(o.title) + "</span>" + (tags.length ? '<span class="tags">' + tags.join("") + "</span>" : "") + "</span>" +
      '<span class="c-loc">' + esc(o.location || "Sede da verificare") + "</span>" +
      '<span class="c-dur">' + esc(dur || "Durata non indicata") + (o.period_text ? '<span class="col-sub">' + esc(o.period_text) + "</span>" : "") + "</span>" +
      '<span class="c-state">' + (a.status ? '<span class="pill ' + esc(a.status) + '">' + esc(statusLabel(a.status)) + "</span>" : '<span class="muted small">Non ancora</span>') + "</span>" +
      "</button></li>";
  }

  function renderExcluded(excl) {
    var wrap = $("#excludedWrap");
    if (!excl.length) { wrap.innerHTML = ""; return; }
    var html = '<label class="check"><input type="checkbox" id="fExcl"' + (S.prefs.excluded ? " checked" : "") + "> Mostra le " + excl.length + " offerte scartate e perché</label>";
    if (S.prefs.excluded) {
      html += '<ul class="excluded-list">' + excl.map(function (e) {
        return "<li><strong>" + esc(e.company) + "</strong>: " + esc(e.title) + (e.location ? " (" + esc(e.location) + ")" : "") +
          '<span class="why">Scartata: ' + esc((e.reasons || []).join("; ")) + (e.url ? ' · <a href="' + esc(safeUrl(e.url)) + '" target="_blank" rel="noopener">annuncio</a>' : "") + "</span></li>";
      }).join("") + "</ul>";
    }
    wrap.innerHTML = html;
    $("#fExcl").addEventListener("change", function (e) { S.prefs.excluded = e.target.checked; savePrefs(); renderExcluded(excl); });
  }

  /* ------------------------------------------------------------ righello scadenze */
  function renderRuler(list) {
    var el = $("#ruler");
    var note = $("#rulerNote");
    var W = Math.max(280, el.clientWidth || 800);
    var dated = list.filter(function (o) { return o.deadline && daysLeft(o.deadline) >= 0; });
    var undated = list.filter(function (o) { return !o.deadline; }).length;
    var past = list.filter(function (o) { return o.deadline && daysLeft(o.deadline) < 0; }).length;
    if (!dated.length) {
      el.style.height = "0";
      el.innerHTML = "";
      note.textContent = "Nessuna scadenza futura tra le offerte mostrate." + (undated ? " " + plural(undated, "offerta non indica", "offerte non indicano") + " una scadenza." : "");
      return;
    }
    var maxD = Math.max.apply(null, dated.map(function (o) { return daysLeft(o.deadline); }));
    var span = Math.min(180, Math.max(45, maxD + 10));
    var pad = 14;
    function xOf(days) { return pad + (days / span) * (W - 2 * pad); }

    var groups = {};
    dated.forEach(function (o) { (groups[o.deadline] = groups[o.deadline] || []).push(o); });
    var items = Object.keys(groups).sort().map(function (iso) {
      var os = groups[iso];
      var names = [];
      os.forEach(function (o) { if (names.indexOf(o.company) === -1) names.push(o.company); });
      var d = daysLeft(iso);
      var label = names.join(", ") + " · " + fmtShort(iso);
      return { iso: iso, d: d, x: xOf(d), label: label, id: os[0].id, w: label.length * 6.9 + 18 };
    });

    var lanes = [];
    items.forEach(function (it) {
      var flip = it.x + it.w > W - 4;
      var start = flip ? it.x - it.w : it.x;
      var end = flip ? it.x : it.x + it.w;
      var lane = 0;
      while (lanes[lane] != null && lanes[lane] + 6 > start) lane++;
      lanes[lane] = end;
      it.flip = flip;
      it.lane = lane;
    });
    var laneH = 26, top = 4;
    var axisY = top + lanes.length * laneH + 10;
    var html = '<div class="axis" style="top:' + axisY + 'px"></div>';
    var cur = new Date();
    for (var m = 0; m < 8; m++) {
      var md = new Date(cur.getFullYear(), cur.getMonth() + m, 1);
      var dd = Math.round((Date.UTC(md.getFullYear(), md.getMonth(), 1) - todayUTC()) / 86400000);
      if (dd > 0 && dd <= span) {
        html += '<span class="tick" style="left:' + xOf(dd) + "px;top:" + axisY + 'px"></span><span class="tick-label" style="left:' + xOf(dd) + "px;top:" + (axisY + 12) + 'px">' + MON[md.getMonth()] + "</span>";
      }
    }
    html += '<span class="tick" style="left:' + pad + "px;top:" + axisY + 'px"></span><span class="tick-label" style="left:' + (pad + 14) + "px;top:" + (axisY + 12) + 'px">oggi</span>';
    items.forEach(function (it) {
      var cls = it.d <= 10 ? "urgent" : it.d <= 30 ? "soon" : "";
      var y = top + it.lane * laneH;
      html += '<span class="stem" style="left:' + it.x + "px;top:" + (y + 22) + "px;height:" + (axisY - y - 22) + 'px"></span>' +
        '<span class="dot ' + cls + '" style="left:' + it.x + "px;top:" + (axisY + 1) + 'px"></span>' +
        '<button type="button" class="flag ' + cls + (it.flip ? " left" : "") + '" data-open="' + esc(it.id) + '" style="left:' + it.x + "px;top:" + y + 'px">' + esc(it.label) + "</button>";
    });
    el.style.height = axisY + 34 + "px";
    el.innerHTML = html;
    var bits = [];
    if (undated) bits.push(plural(undated, "offerta non indica", "offerte non indicano") + " una scadenza");
    if (past) bits.push(plural(past, "offerta ha la scadenza passata", "offerte hanno la scadenza passata"));
    note.textContent = bits.join(" · ");
  }

  /* ------------------------------------------------------------ pannello dettaglio */
  function openDrawer(id, trigger) {
    var o = getOffer(id);
    if (!o) return;
    S.openId = id;
    S.lastTrigger = trigger || document.activeElement;
    var d = $("#drawer");
    d.innerHTML = drawerHTML(o);
    d.hidden = false;
    $("#scrim").hidden = false;
    d.scrollTop = 0;
    d.focus();
    bindDrawer(o);
  }
  function closeDrawer() {
    $("#drawer").hidden = true;
    $("#scrim").hidden = true;
    S.openId = null;
    if (S.lastTrigger && S.lastTrigger.focus && document.contains(S.lastTrigger)) S.lastTrigger.focus();
  }

  function drawerHTML(o) {
    var d = o.deadline ? daysLeft(o.deadline) : null;
    var dl = o.deadline
      ? fmtDate(o.deadline) + (d >= 0 ? ' <span class="' + (d <= 10 ? "urgent" : "") + '">(' + (d === 0 ? "oggi" : plural(d, "giorno", "giorni") + " rimasti") + ")</span>" : " (scaduta)")
      : "non indicata";
    var a = appOf(o.id);
    var hasProfile = !!S.profile;
    var facts = [
      ["Sede", esc(o.location || "da verificare")],
      ["Scadenza", dl + (o.deadline_note ? '<br><span class="muted small">' + esc(o.deadline_note) + "</span>" : "")],
      ["Pubblicata", o.published ? fmtDate(o.published) : "data non indicata"],
      ["Durata", esc(durationLabel(o) || "non indicata")],
      ["Periodo", esc(o.period_text || "non indicato")],
      ["Dati", esc(o.confidence || (o.origin === "auto" ? "letti dallo scraper" : "")) + (o.checked_on ? '<br><span class="muted small">controllati il ' + esc(fmtDate(o.checked_on)) + "</span>" : "")],
    ];
    if (o.verdict === "check") facts.push(["Da verificare", esc((o.reasons || []).join(", "))]);
    var h = '<div class="drawer-head"><div><p class="co">' + esc(o.company) + " · " + esc(CATEGORIES[o.category] || "") + "</p><h2>" + esc(o.title) + '</h2></div><button type="button" class="close" data-close>Chiudi</button></div>' +
      '<dl class="facts">' + facts.map(function (f) { return "<dt>" + f[0] + "</dt><dd>" + f[1] + "</dd>"; }).join("") + "</dl>" +
      '<div class="block"><h3>Passaggi di selezione</h3><p>' + (o.process_text ? esc(o.process_text) : '<span class="muted">Non indicati nell\'annuncio.</span>') + "</p></div>";
    if (o.requirements) h += '<div class="block"><h3>Requisiti</h3><p>' + esc(o.requirements) + "</p></div>";
    if (o.summary || o.description) {
      h += '<div class="block"><h3>Descrizione</h3><p class="desc">' + esc(o.description && o.description.length > (o.summary || "").length ? o.description : o.summary) + "</p></div>";
    }
    h += '<p style="margin-bottom:20px"><a class="btn" href="' + esc(safeUrl(o.url)) + '" target="_blank" rel="noopener">Apri l\'annuncio</a></p>';

    h += '<section class="panel" aria-labelledby="trk"><h3 id="trk">La tua candidatura</h3><div class="form-grid">' +
      '<div><label class="lbl" for="aStatus">Stato</label><select id="aStatus" data-field="status"><option value="">Non ancora</option>' +
      STATUSES.map(function (s) { return '<option value="' + s.id + '"' + (a.status === s.id ? " selected" : "") + ">" + s.label + "</option>"; }).join("") + "</select></div>" +
      '<div><label class="lbl" for="aDate">Candidato il</label><input type="date" id="aDate" data-field="appliedOn" value="' + esc(a.appliedOn || "") + '"></div>' +
      '<div><label class="lbl" for="aPlan">Colloqui previsti</label><input type="number" min="0" id="aPlan" data-field="interviewsPlanned" value="' + esc(a.interviewsPlanned == null ? "" : a.interviewsPlanned) + '"></div>' +
      '<div><label class="lbl" for="aDone">Colloqui sostenuti</label><input type="number" min="0" id="aDone" data-field="interviewsDone" value="' + esc(a.interviewsDone == null ? "" : a.interviewsDone) + '"></div>' +
      '<div class="full"><label class="check"><input type="checkbox" data-field="assessmentDone"' + (a.assessmentDone ? " checked" : "") + "> Assessment online completato</label></div>" +
      '<div class="full"><label class="lbl" for="aNotes">Note</label><textarea id="aNotes" data-field="notes" placeholder="Contatti, date dei colloqui, cose da ricordare">' + esc(a.notes || "") + "</textarea></div></div></section>";

    h += '<section class="panel" aria-labelledby="cvh"><h3 id="cvh">CV e lettera per questa offerta</h3>';
    if (!hasProfile) {
      h += '<p class="small">Per creare i documenti serve il tuo profilo. <a href="#profilo" data-close>Caricalo nella scheda Profilo e CV</a>: lo fai una volta sola e resta nel tuo browser.</p>';
    } else {
      h += '<div class="form-grid"><div><label class="lbl" for="cvLang">Lingua</label><select id="cvLang"><option value="en"' + (S.prefs.lang === "en" ? " selected" : "") + '>Inglese</option><option value="it"' + (S.prefs.lang === "it" ? " selected" : "") + ">Italiano</option></select></div></div>" +
        '<div style="margin-top:10px"><label class="lbl" for="cvWhy">Perché ' + esc(o.company) + " (1 o 2 frasi, per la lettera)</label>" +
        '<textarea id="cvWhy" data-field="why" placeholder="Scrivi un motivo specifico per questa azienda. Se lo lasci vuoto la lettera usa una frase generica.">' + esc(a.why || "") + "</textarea></div>" +
        '<div class="row-actions"><button type="button" class="btn small" data-gen="cv">Scarica il CV (.docx)</button><button type="button" class="btn small ghost" data-gen="letter">Scarica la lettera (.docx)</button></div>' +
        '<ul class="chosen" id="chosen" aria-live="polite"></ul>';
    }
    h += "</section>";
    if (o.origin === "utente") h += '<p><button type="button" class="btn ghost small" data-act="delete-manual" data-id="' + esc(o.id) + '">Elimina questa offerta</button></p>';
    return h;
  }

  function bindDrawer(o) {
    $$("#drawer [data-field]").forEach(function (el) {
      var handler = function () {
        var a = S.apps[o.id] || (S.apps[o.id] = {});
        var f = el.getAttribute("data-field");
        var val = el.type === "checkbox" ? el.checked : el.value;
        if (f === "interviewsPlanned" || f === "interviewsDone") val = val === "" ? null : Math.max(0, parseInt(val, 10) || 0);
        a[f] = val;
        if (f === "status" && val && val !== "todo" && !a.appliedOn) { a.appliedOn = isoToday(); var di = $("#aDate"); if (di) di.value = a.appliedOn; }
        if (f === "status" && !val) delete a.status;
        saveApps();
        if (f === "status" || f === "appliedOn") refreshBehind();
      };
      el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date" ? "change" : "input", handler);
    });
    var lang = $("#cvLang");
    if (lang) lang.addEventListener("change", function () { S.prefs.lang = lang.value; savePrefs(); });
  }

  function refreshBehind() {
    if (S.view === "offerte") updateOfferte();
    else if (S.view === "candidature") renderCandidature();
  }

  function generate(kind) {
    var o = getOffer(S.openId);
    if (!o || !S.profile) return;
    if (!window.docx || !window.DocGen) { toast("La libreria per i file Word non si è caricata. Ricarica la pagina."); return; }
    var opts = { lang: S.prefs.lang, why: appOf(o.id).why || "", includeProfileLine: S.prefs.profileLine };
    var res;
    try {
      res = kind === "cv" ? window.DocGen.buildCV(window.docx, S.profile, o, opts) : window.DocGen.buildLetter(window.docx, S.profile, o, opts);
    } catch (e) { toast("Non riesco a creare il documento: controlla il file del profilo."); return; }
    window.docx.Packer.toBlob(res.doc).then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = window.DocGen.fileName(kind, S.profile, o, opts.lang);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      var list = $("#chosen");
      if (list) list.innerHTML = res.notes.length ? res.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") : "<li>Nessuna modifica rispetto al CV base: l'offerta non richiama punti particolari del profilo.</li>";
      toast("File creato: " + a.download);
    });
  }

  /* ------------------------------------------------------------ vista: candidature */
  function renderCandidature() {
    var v = $("#view");
    var rows = [];
    Object.keys(S.apps).forEach(function (id) {
      var a = S.apps[id];
      var o = getOffer(id);
      if (a.status && o) rows.push({ o: o, a: a });
    });
    var applied = rows.filter(function (r) { return r.a.status !== "todo"; }).length;
    var inProgress = rows.filter(function (r) { return r.a.status === "assessment" || r.a.status === "interviews"; }).length;
    var offers = rows.filter(function (r) { return r.a.status === "offer"; }).length;
    var html = '<div class="page-head"><h2>Le tue candidature</h2><p>Stato, passaggi e note per ogni offerta. I dati restano nel tuo browser: per non perderli, esporta un backup ogni tanto.</p></div>' +
      '<div class="counters"><div><span class="n">' + rows.length + '</span><span class="u">seguite</span></div><div><span class="n">' + applied + '</span><span class="u">candidature inviate</span></div><div><span class="n">' + inProgress + '</span><span class="u">in selezione</span></div><div><span class="n">' + offers + '</span><span class="u">offerte ricevute</span></div></div>' +
      '<div class="toolbar"><button type="button" class="btn small" data-act="add">Aggiungi un\'offerta</button><button type="button" class="btn small ghost" data-act="export">Esporta backup</button><button type="button" class="btn small ghost" data-act="import">Importa backup</button><button type="button" class="btn small ghost" data-act="csv">Esporta in CSV</button></div>';
    if (!rows.length) {
      html += '<p class="empty"><strong>Non stai ancora seguendo nessuna offerta.</strong> Apri un\'offerta dalla scheda Offerte e scegli uno stato nel riquadro «La tua candidatura».</p>';
    }
    STATUSES.forEach(function (s) {
      var group = rows.filter(function (r) { return r.a.status === s.id; });
      if (!group.length) return;
      group.sort(function (x, y) { return (x.o.deadline || "9999").localeCompare(y.o.deadline || "9999"); });
      html += '<section class="group"><h3>' + s.label + " (" + group.length + ")</h3>" + group.map(function (r) {
        var steps = [];
        if (r.a.assessmentDone) steps.push("assessment fatto");
        if (r.a.interviewsDone != null || r.a.interviewsPlanned != null) steps.push("colloqui " + (r.a.interviewsDone || 0) + (r.a.interviewsPlanned != null ? " di " + r.a.interviewsPlanned : ""));
        var d = r.o.deadline ? daysLeft(r.o.deadline) : null;
        return '<button type="button" class="app-row" data-open="' + esc(r.o.id) + '"><span><strong>' + esc(r.o.company) + "</strong> · " + esc(r.o.title) + "</span>" +
          '<span class="muted small">' + (r.a.appliedOn ? "candidato il " + esc(fmtShort(r.a.appliedOn)) : d != null && d >= 0 ? "scade tra " + plural(d, "giorno", "giorni") : r.o.deadline ? "scadenza passata" : "senza scadenza") + "</span>" +
          '<span class="muted small">' + esc(steps.join(" · ")) + "</span></button>";
      }).join("") + "</section>";
    });
    v.innerHTML = html;
  }

  /* ------------------------------------------------------------ vista: fonti */
  function renderFonti() {
    var v = $("#view");
    var src = (S.data && S.data.sources) || [];
    var auto = src.filter(function (s) { return s.type !== "manual"; });
    var manual = src.filter(function (s) { return s.type === "manual"; });
    var opens = src.filter(function (s) { return s.opens_hint; });
    var html = '<div class="page-head"><h2>Fonti</h2><p>Solo siti ufficiali dei datori di lavoro. ' + auto.length + " vengono lette ogni giorno dallo scraper, " + manual.length + " vanno controllate a mano (di solito perché la pagina non si può leggere automaticamente).</p></div>";
    if (S.loadError) html += '<p class="empty"><strong>Dati non caricati.</strong> ' + esc(S.loadError) + "</p>";
    if (opens.length) {
      html += '<section class="section"><h3>Quando riaprono le candidature</h3><ul class="list-plain">' + opens.map(function (s) {
        return "<li><strong>" + esc(s.name) + "</strong> (" + esc(s.city) + "): " + esc(s.opens_hint) + ' <a href="' + esc(safeUrl(s.careers_url)) + '" target="_blank" rel="noopener">pagina ufficiale</a></li>';
      }).join("") + "</ul></section>";
    }
    html += '<section class="section" style="max-width:none"><h3>Lette ogni giorno</h3><table class="table"><thead><tr><th>Fonte</th><th>Sede</th><th>Ultimo controllo</th><th>Offerte lette</th><th>Note</th></tr></thead><tbody>' + auto.map(function (s) {
      var ok = s.run === "ok";
      var state = s.run === "ok" ? '<span class="state-ok">riuscito</span>' : s.run === "non eseguita" ? "non ancora eseguito" : '<span class="state-bad">' + esc(s.run) + "</span>";
      return '<tr><td><a href="' + esc(safeUrl(s.careers_url)) + '" target="_blank" rel="noopener">' + esc(s.name) + "</a></td><td>" + esc(s.city) + "</td><td>" + state + "</td><td>" + (ok ? s.count : "–") + "</td><td>" + esc(s.error || s.note || "") + "</td></tr>";
    }).join("") + "</tbody></table></section>";
    html += '<section class="section" style="max-width:none"><h3>Da controllare a mano</h3><table class="table"><thead><tr><th>Fonte</th><th>Sede</th><th>Cosa dice la pagina</th><th>Controllata</th></tr></thead><tbody>' + manual.map(function (s) {
      var c = S.checks[s.id];
      return '<tr><td><a href="' + esc(safeUrl(s.careers_url)) + '" target="_blank" rel="noopener">' + esc(s.name) + "</a>" + (s.verified ? "" : '<br><span class="muted small">link non verificato</span>') + "</td><td>" + esc(s.city) + "</td><td>" + esc(s.note || "") + "</td><td>" +
        (c ? esc(fmtShort(c)) + " " : "") + '<button type="button" class="btn ghost small" data-act="check-source" data-id="' + esc(s.id) + '">Segna oggi</button></td></tr>';
    }).join("") + "</tbody></table></section>";
    v.innerHTML = html;
  }

  /* ------------------------------------------------------------ vista: profilo */
  function renderProfilo() {
    var v = $("#view");
    var p = S.profile;
    v.innerHTML = '<div class="page-head"><h2>Profilo e CV</h2><p>Da qui prepari il CV e la lettera in Word per ogni offerta. Il profilo contiene i tuoi dati personali, quindi resta solo nel tuo browser e non va caricato su GitHub.</p></div>' +
      '<section class="section"><h3>' + (p ? "Profilo caricato" : "Nessun profilo caricato") + "</h3>" +
      (p ? "<p><strong>" + esc((p.personal || {}).name || "") + "</strong>: " + plural((p.education || []).length, "formazione", "formazioni") + ", " + plural((p.experience || []).filter(function (e) { return e.enabled !== false; }).length, "esperienza", "esperienze") + ".</p>" : "<p>Scegli il file del profilo (JSON). Per vedere com'è fatto, apri il file di esempio.</p>") +
      '<div class="row-actions"><button type="button" class="btn small" data-act="load-profile">' + (p ? "Sostituisci il profilo" : "Carica il profilo") + '</button>' + (p ? '<button type="button" class="btn small ghost" data-act="clear-profile">Rimuovi dal browser</button>' : "") +
      '<a class="btn small ghost" href="profile.example.json" download>Scarica il file di esempio</a></div></section>' +
      '<section class="section"><h3>Preferenze dei documenti</h3><div class="form-grid"><div><label class="lbl" for="pLang">Lingua predefinita</label><select id="pLang"><option value="en"' + (S.prefs.lang === "en" ? " selected" : "") + '>Inglese</option><option value="it"' + (S.prefs.lang === "it" ? " selected" : "") + ">Italiano</option></select></div>" +
      '<div><label class="check" style="margin-top:22px"><input type="checkbox" id="pLine"' + (S.prefs.profileLine ? " checked" : "") + "> Aggiungi la riga di profilo in cima al CV</label></div></div></section>" +
      '<section class="section"><h3>Come vengono personalizzati i documenti</h3><p>Il CV parte dal tuo profilo e cambia in base all\'offerta: la riga di profilo cita il settore dell\'azienda e i punti facoltativi (per esempio la tesi sul venture capital) compaiono solo se l\'offerta li richiama. Nella lettera vengono scelte le due esperienze più vicine al testo dell\'annuncio e la frase «perché questa azienda» è quella che scrivi tu.</p><p>È una personalizzazione a regole, non un testo riscritto da zero. Per un\'offerta importante conviene rifinire il file Word a mano.</p></section>';
    $("#pLang").addEventListener("change", function (e) { S.prefs.lang = e.target.value; savePrefs(); });
    $("#pLine").addEventListener("change", function (e) { S.prefs.profileLine = e.target.checked; savePrefs(); });
  }

  function pickFile(accept, cb) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { cb(String(r.result)); };
      r.readAsText(f);
    });
    inp.click();
  }

  function download(name, text, type) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ------------------------------------------------------------ aggiunta manuale */
  function openAddDialog() {
    var dlg = $("#addDialog");
    dlg.innerHTML = '<form method="dialog" id="addForm"><h2 id="addTitle">Aggiungi un\'offerta</h2><div class="form-grid">' +
      '<div><label class="lbl" for="nCo">Azienda</label><input type="text" id="nCo" required></div>' +
      '<div><label class="lbl" for="nCat">Tipo</label><select id="nCat">' + Object.keys(CATEGORIES).map(function (k) { return '<option value="' + k + '">' + CATEGORIES[k] + "</option>"; }).join("") + "</select></div>" +
      '<div class="full"><label class="lbl" for="nTi">Ruolo</label><input type="text" id="nTi" required></div>' +
      '<div><label class="lbl" for="nLoc">Sede</label><input type="text" id="nLoc" placeholder="Lugano"></div>' +
      '<div><label class="lbl" for="nDl">Scadenza</label><input type="date" id="nDl"></div>' +
      '<div class="full"><label class="lbl" for="nUrl">Link all\'annuncio</label><input type="url" id="nUrl" placeholder="https://" required></div>' +
      '<div><label class="lbl" for="nDur">Durata</label><input type="text" id="nDur" placeholder="10 settimane"></div>' +
      '<div><label class="lbl" for="nPer">Periodo</label><input type="text" id="nPer" placeholder="Giugno-agosto 2027"></div>' +
      '<div class="full"><label class="lbl" for="nPro">Passaggi di selezione</label><input type="text" id="nPro" placeholder="Per esempio: test online, 2 colloqui"></div>' +
      '<div class="full"><label class="lbl" for="nDes">Descrizione o note</label><textarea id="nDes"></textarea></div></div>' +
      '<div class="row-actions"><button class="btn" value="ok" id="nSave">Salva</button><button class="btn ghost" value="cancel" formnovalidate>Annulla</button></div></form>';
    dlg.showModal();
    $("#nSave").addEventListener("click", function (e) {
      var form = $("#addForm");
      if (!form.checkValidity()) return;
      e.preventDefault();
      var loc = $("#nLoc").value.trim();
      var offer = {
        id: "u-" + Date.now().toString(36), source_id: "utente", origin: "utente", verdict: "utente", reasons: [], relevance: "alta",
        company: $("#nCo").value.trim(), category: $("#nCat").value, title: $("#nTi").value.trim(), location: loc, location_class: classifyLocation(loc),
        url: $("#nUrl").value.trim(), published: null, deadline: $("#nDl").value || null, deadline_note: "", duration_text: $("#nDur").value.trim(),
        period_text: $("#nPer").value.trim(), process_text: $("#nPro").value.trim(), requirements: "", summary: $("#nDes").value.trim().slice(0, 280),
        description: $("#nDes").value.trim(), confidence: "inserita da te", checked_on: isoToday(), first_seen: isoToday(), duration_months: [],
      };
      S.manual.push(offer);
      sset("manual", S.manual);
      dlg.close();
      toast("Offerta aggiunta");
      render();
    });
  }

  /* ------------------------------------------------------------ routing e avvio */
  function render() {
    $$(".tabs a").forEach(function (a) { a.toggleAttribute("aria-current", a.getAttribute("data-tab") === S.view); if (a.getAttribute("data-tab") === S.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (S.view === "candidature") renderCandidature();
    else if (S.view === "fonti") renderFonti();
    else if (S.view === "profilo") renderProfilo();
    else renderOfferte();
    var u = $("#updated");
    if (S.data && S.data.generated_at) {
      var dt = new Date(S.data.generated_at);
      u.textContent = "Dati aggiornati il " + dt.toLocaleDateString("it-IT", { day: "numeric", month: "short" }) + " alle " + dt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    } else u.textContent = "";
  }

  function route() {
    var h = (location.hash || "#offerte").replace(/^#/, "");
    var m = h.match(/^offerta\/(.+)$/);
    S.view = ["offerte", "candidature", "fonti", "profilo"].indexOf(h) !== -1 ? h : "offerte";
    render();
    if (m && getOffer(decodeURIComponent(m[1]))) openDrawer(decodeURIComponent(m[1]), null);
    else if (!$("#drawer").hidden && h !== "offerte" && !m) closeDrawer();
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-open],[data-close],[data-gen],[data-act]");
    if (e.target.id === "scrim") { closeDrawer(); return; }
    if (!t) return;
    if (t.hasAttribute("data-open")) { openDrawer(t.getAttribute("data-open"), t); return; }
    if (t.hasAttribute("data-close")) { closeDrawer(); return; }
    if (t.hasAttribute("data-gen")) { generate(t.getAttribute("data-gen")); return; }
    var act = t.getAttribute("data-act");
    if (act === "add") openAddDialog();
    else if (act === "export") download("stage2027-backup-" + isoToday() + ".json", JSON.stringify({ version: 1, exported_at: new Date().toISOString(), apps: S.apps, manual: S.manual, checks: S.checks }, null, 1), "application/json");
    else if (act === "import") pickFile(".json,application/json", function (txt) {
      try {
        var b = JSON.parse(txt);
        if (!b || typeof b.apps !== "object") throw new Error("formato");
        S.apps = b.apps || {}; S.manual = b.manual || []; S.checks = b.checks || {};
        saveApps(); sset("manual", S.manual); sset("checks", S.checks);
        toast("Backup importato"); render();
      } catch (err) { toast("Questo file non sembra un backup di Stage 2027."); }
    });
    else if (act === "csv") {
      var q = function (x) { return '"' + String(x == null ? "" : x).replace(/"/g, '""') + '"'; };
      var lines = [["Azienda", "Ruolo", "Sede", "Stato", "Scadenza", "Candidato il", "Colloqui fatti", "Colloqui previsti", "Link", "Note"].map(q).join(",")];
      Object.keys(S.apps).forEach(function (id) {
        var o = getOffer(id), a = S.apps[id];
        if (o && a.status) lines.push([o.company, o.title, o.location, statusLabel(a.status), o.deadline || "", a.appliedOn || "", a.interviewsDone == null ? "" : a.interviewsDone, a.interviewsPlanned == null ? "" : a.interviewsPlanned, o.url, a.notes || ""].map(q).join(","));
      });
      download("stage2027-candidature-" + isoToday() + ".csv", "﻿" + lines.join("\r\n"), "text/csv");
    }
    else if (act === "load-profile") pickFile(".json,application/json", function (txt) {
      try {
        var p = JSON.parse(txt);
        if (!p || !p.personal || !p.personal.name || !Array.isArray(p.education) || !Array.isArray(p.experience)) throw new Error("formato");
        S.profile = p; sset("profile", p); toast("Profilo caricato"); render();
      } catch (err) { toast("Il file non è un profilo valido: confrontalo con il file di esempio."); }
    });
    else if (act === "clear-profile") { S.profile = null; sset("profile", null); toast("Profilo rimosso dal browser"); render(); }
    else if (act === "check-source") { S.checks[t.getAttribute("data-id")] = isoToday(); sset("checks", S.checks); renderFonti(); }
    else if (act === "delete-manual") {
      var id = t.getAttribute("data-id");
      S.manual = S.manual.filter(function (o) { return o.id !== id; });
      delete S.apps[id];
      sset("manual", S.manual); saveApps(); closeDrawer(); render();
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });
  window.addEventListener("hashchange", route);
  var rz;
  window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { if (S.view === "offerte") updateOfferte(); }, 150); });

  function boot() {
    fetch("data/offers.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { S.data = d; })
      .catch(function (e) {
        S.loadError = "Non riesco a leggere data/offers.json (" + String(e.message || e) + "). Se hai aperto il file index.html direttamente dal computer, avvia un piccolo server (python3 -m http.server dentro la cartella site) oppure usa l'indirizzo di GitHub Pages.";
      })
      .then(function () {
        route();
        if (S.loadError && S.view === "offerte") $("#summary").textContent = S.loadError;
        if (!persistOk) toast("Il browser non permette di salvare dati: le candidature non verranno conservate.");
      });
  }
  boot();
})();
