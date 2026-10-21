/* Generatore di CV e lettera di presentazione (.docx), eseguito nel browser.
 *
 * Non usa nessun servizio esterno e non scrive nulla online: il profilo personale resta nel
 * browser (localStorage) e il file viene creato sul tuo computer.
 *
 * La personalizzazione è a regole, non generata da un modello linguistico:
 *  - sceglie la frase di profilo in base al tipo di azienda;
 *  - include i punti facoltativi (es. la tesi sul venture capital) solo se l'offerta li richiama;
 *  - per la lettera sceglie le 2 esperienze più vicine al testo dell'offerta;
 *  - usa la frase "perché questa azienda" che scrivi tu (se la lasci vuota ne usa una generica).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DocGen = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FOCUS = {
    banca: { en: "banking and corporate finance", it: "banking e corporate finance" },
    asset_management: { en: "asset management and investments", it: "asset management e investimenti" },
    vc_pe: { en: "venture capital and private equity", it: "venture capital e private equity" },
    family_office: { en: "wealth and investment management", it: "gestione patrimoniale e investimenti" },
    fintech: { en: "fintech and digital finance", it: "fintech e finanza digitale" },
    altro: { en: "finance", it: "finanza" },
  };

  var CATEGORY_TAGS = {
    banca: ["valuation", "corporate finance", "banking", "credit", "financial statement", "risk"],
    asset_management: ["investment", "portfolio", "equity", "markets", "valuation"],
    vc_pe: ["venture capital", "startup", "start-up", "private equity", "valuation", "growth"],
    family_office: ["wealth", "investment", "portfolio"],
    fintech: ["fintech", "digital", "python", "data", "technology"],
    altro: [],
  };

  var T = {
    en: {
      profile: "PROFILE",
      education: "EDUCATION",
      experience: "WORK EXPERIENCE",
      skills: "SKILLS & VOLUNTEERING",
      email: "E-mail",
      phone: "Phone",
      address: "Address",
      linkedin: "LinkedIn",
      software: "Software",
      languages: "Languages",
      volunteering: "Volunteering",
      lookingFor: function (focus) { return "Looking for a summer 2027 internship in " + focus + "."; },
      subject: function (role, company) { return "Application: " + role + ", " + company; },
      to: function (company) { return "Hiring team, " + company; },
      dear: "Dear Hiring Team,",
      why: function (company, focus) {
        return "I would like to join " + company + " to learn how " + focus + " works in practice and to contribute with rigour, curiosity and a strong work ethic.";
      },
      closing: "I would welcome the opportunity to discuss my application in an interview. Thank you for your time and consideration.",
      regards: "Kind regards,",
      dateLocale: "en-GB",
    },
    it: {
      profile: "PROFILO",
      education: "FORMAZIONE",
      experience: "ESPERIENZE LAVORATIVE",
      skills: "COMPETENZE E VOLONTARIATO",
      email: "E-mail",
      phone: "Telefono",
      address: "Indirizzo",
      linkedin: "LinkedIn",
      software: "Software",
      languages: "Lingue",
      volunteering: "Volontariato",
      lookingFor: function (focus) { return "Cerco uno stage estivo 2027 in ambito " + focus + "."; },
      subject: function (role, company) { return "Candidatura: " + role + ", " + company; },
      to: function (company) { return "Team Risorse Umane, " + company; },
      dear: "Gentili Signori,",
      why: function (company, focus) {
        return "Vorrei entrare in " + company + " per capire come funziona nella pratica l'ambito " + focus + " e contribuire con rigore, curiosità e impegno.";
      },
      closing: "Resto a disposizione per un colloquio e vi ringrazio per il tempo dedicato alla mia candidatura.",
      regards: "Cordiali saluti,",
      dateLocale: "it-IT",
    },
  };

  function lang(l) { return l === "it" ? "it" : "en"; }
  function tr(obj, l) { return obj && (obj[l] || obj.en || obj.it || ""); }

  function haystack(offer) {
    return [offer.title, offer.summary, offer.description, offer.requirements, offer.process_text, offer.category]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function has(hay, tag) {
    var t = String(tag).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9\u00e0-\u00ff])" + t + "(?:s|es)?([^a-z0-9\u00e0-\u00ff]|$)").test(hay);
  }

  function score(tags, hay, extra) {
    var s = 0, hits = [];
    (tags || []).forEach(function (t) {
      if (has(hay, t)) { s += 2; hits.push(t); }
    });
    (tags || []).forEach(function (t) {
      if ((extra || []).indexOf(String(t).toLowerCase()) !== -1) { s += 1; }
    });
    return { score: s, hits: hits };
  }

  function formatFullDate(l, d) {
    return (d || new Date()).toLocaleDateString(T[l].dateLocale, { day: "numeric", month: "long", year: "numeric" });
  }

  /* Sceglie i contenuti per una specifica offerta. Funzione pura: facile da verificare. */
  function selectContent(profile, offer, opts) {
    opts = opts || {};
    var l = lang(opts.lang);
    var hay = haystack(offer);
    var extra = CATEGORY_TAGS[offer.category] || [];
    var notes = [];
    var maxBullets = opts.maxBullets || 3;

    function pickBullets(entry) {
      var scored = (entry.bullets || []).map(function (b, i) {
        var sc = score(b.tags, hay, extra);
        return { b: b, i: i, s: sc.score, hits: sc.hits };
      });
      var kept = scored.filter(function (x) {
        if (x.b.optional && x.s === 0) return false;
        return true;
      });
      scored.forEach(function (x) {
        if (x.b.optional && x.s > 0) notes.push("Incluso (richiamato dall'offerta): " + tr(x.b, l).slice(0, 70) + "…  [" + x.hits.join(", ") + "]");
      });
      if (kept.length > maxBullets) {
        var top = kept.slice().sort(function (a, b) { return b.s - a.s || a.i - b.i; }).slice(0, maxBullets);
        kept = kept.filter(function (x) { return top.indexOf(x) !== -1; });
      }
      return kept.map(function (x) { return tr(x.b, l); });
    }

    function entries(list) {
      return (list || []).filter(function (e) { return e.enabled !== false; }).map(function (e) {
        return { title: tr(e.title, l), org: e.org || "", place: e.place || "", dates: tr(e.dates, l), bullets: pickBullets(e) };
      });
    }

    var focus = tr(FOCUS[offer.category] || FOCUS.altro, l);
    var line = tr(profile.profile_line, l);
    (profile.profile_addons || []).forEach(function (a) {
      var sc = score(a.tags, hay, extra);
      if (sc.score > 0) { line += " " + tr(a, l); notes.push("Profilo: aggiunta la frase «" + tr(a, l).slice(0, 60) + "…» [" + sc.hits.join(", ") + "]"); }
    });
    line += " " + T[l].lookingFor(focus);

    var points = (profile.letter_points || []).filter(function (p) { return p.enabled !== false; }).map(function (p, i) {
      var sc = score(p.tags, hay, extra);
      return { p: p, i: i, s: sc.score, hits: sc.hits };
    });
    var best = points.slice().sort(function (a, b) { return b.s - a.s || a.i - b.i; }).slice(0, 2)
      .sort(function (a, b) { return a.i - b.i; });
    best.forEach(function (x) { notes.push("Lettera: scelto «" + x.p.id + "»" + (x.hits.length ? " [" + x.hits.join(", ") + "]" : " (nessuna parola in comune: scelta di default)")); });

    var skills = profile.skills || {};
    return {
      lang: l,
      focus: focus,
      profileLine: line,
      education: entries(profile.education),
      experience: entries(profile.experience),
      software: tr(skills.software, l),
      languages: tr(skills.languages, l),
      volunteering: tr(skills.volunteering, l),
      letterPoints: best.map(function (x) { return tr(x.p, l); }),
      notes: notes,
    };
  }

  var PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1020, CONTENT_W = PAGE_W - 2 * MARGIN;
  var FONT = "Times New Roman";

  function baseDoc(docx, children) {
    return new docx.Document({
      creator: "",
      styles: { default: { document: { run: { font: FONT, size: 21 } } } },
      numbering: {
        config: [{
          reference: "bul",
          levels: [{ level: 0, format: docx.LevelFormat.BULLET, text: "•", alignment: docx.AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
        }],
      },
      sections: [{
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 900, bottom: 800, left: MARGIN, right: MARGIN } } },
        children: children,
      }],
    });
  }

  function buildCV(docx, profile, offer, opts) {
    var P = docx.Paragraph, R = docx.TextRun;
    var sel = selectContent(profile, offer, opts), l = sel.lang, tx = T[l], p = profile.personal || {};
    var kids = [];

    function heading(text) {
      kids.push(new P({
        spacing: { before: 160, after: 80 },
        border: { bottom: { style: docx.BorderStyle.SINGLE, size: 8, space: 1, color: "000000" } },
        children: [new R({ text: text, bold: true, size: 22 })],
      }));
    }
    function labelled(label, value) {
      return [new R({ text: label + " – ", bold: true, size: 21 }), new R({ text: value, size: 21 })];
    }
    function header(title, right) {
      return new P({
        keepNext: true,
        spacing: { before: 90, after: 20 },
        tabStops: [{ type: docx.TabStopType.RIGHT, position: CONTENT_W }],
        children: [
          new R({ text: title, bold: true, size: 21 }),
          new R({ children: [new docx.Tab(), right], italics: true, size: 21 }),
        ],
      });
    }
    function bullet(text) {
      return new P({ numbering: { reference: "bul", level: 0 }, spacing: { after: 10 }, children: [new R({ text: text, size: 21 })] });
    }

    kids.push(new P({ alignment: docx.AlignmentType.CENTER, spacing: { after: 100 }, children: [new R({ text: p.name || "", bold: true, size: 40 })] }));
    kids.push(new P({ spacing: { after: 10 }, children: labelled(tx.email, p.email || "").concat([new R({ text: "    |    ", size: 21 })], labelled(tx.phone, p.phone || "")) }));
    kids.push(new P({ spacing: { after: 20 }, children: labelled(tx.address, p.address || "").concat(p.linkedin ? [new R({ text: "    |    ", size: 21 })].concat(labelled(tx.linkedin, p.linkedin)) : []) }));

    if (!opts || opts.includeProfileLine !== false) {
      heading(tx.profile);
      kids.push(new P({ spacing: { after: 20 }, children: [new R({ text: sel.profileLine, size: 21 })] }));
    }

    heading(tx.education);
    sel.education.forEach(function (e) {
      kids.push(header(e.title, e.dates));
      e.bullets.forEach(function (b) { kids.push(bullet(b)); });
    });

    heading(tx.experience);
    sel.experience.forEach(function (e) {
      kids.push(header(e.title + (e.org ? " | " + e.org : ""), e.dates));
      e.bullets.forEach(function (b) { kids.push(bullet(b)); });
    });

    heading(tx.skills);
    if (sel.software) kids.push(new P({ spacing: { after: 10 }, children: labelled(tx.software, sel.software) }));
    if (sel.languages) kids.push(new P({ spacing: { after: 10 }, children: labelled(tx.languages, sel.languages) }));
    if (sel.volunteering) kids.push(new P({ spacing: { after: 10 }, children: labelled(tx.volunteering, sel.volunteering) }));

    return { doc: baseDoc(docx, kids), notes: sel.notes.filter(function (n) { return n.indexOf("Lettera") !== 0; }), selection: sel };
  }

  function fill(text, vars) {
    return String(text || "").replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }

  function buildLetter(docx, profile, offer, opts) {
    var P = docx.Paragraph, R = docx.TextRun;
    var sel = selectContent(profile, offer, opts), l = sel.lang, tx = T[l], p = profile.personal || {};
    var role = offer.title || "Internship", company = offer.company || "";
    var paren = role.match(/\s*\(([^)]+)\)\s*$/);
    if (paren && String(offer.location || "").toLowerCase().indexOf(paren[1].toLowerCase().slice(0, 4)) !== -1) {
      role = role.slice(0, paren.index);
    }
    var why = (opts && opts.why && opts.why.trim()) || tx.why(company, sel.focus);
    var intro = fill(tr(profile.letter && profile.letter.intro, l), { role: role, company: company });
    var notes = sel.notes.filter(function (n) { return n.indexOf("Lettera") === 0; });
    if (!(opts && opts.why && opts.why.trim())) notes.push("Frase «perché questa azienda»: generica. Scrivine una specifica per " + company + ".");

    function para(text, after) {
      return new P({ alignment: docx.AlignmentType.JUSTIFIED, spacing: { after: after == null ? 160 : after, line: 276 }, children: [new R({ text: text, size: 22 })] });
    }
    var kids = [
      new P({ spacing: { after: 20 }, children: [new R({ text: p.name || "", bold: true, size: 26 })] }),
      new P({ spacing: { after: 0 }, children: [new R({ text: [p.email, p.phone].filter(Boolean).join("  |  "), size: 20 })] }),
      new P({ spacing: { after: 360 }, children: [new R({ text: p.address || "", size: 20 })] }),
      new P({ spacing: { after: 20 }, children: [new R({ text: tx.to(company), size: 22 })] }),
      new P({ spacing: { after: 280 }, children: [new R({ text: formatFullDate(l, opts && opts.date), size: 22 })] }),
      new P({ spacing: { after: 200 }, children: [new R({ text: tx.subject(role, company), bold: true, size: 22 })] }),
      new P({ spacing: { after: 160 }, children: [new R({ text: tx.dear, size: 22 })] }),
      para(intro),
    ];
    if (sel.letterPoints.length) kids.push(para(sel.letterPoints.join(" ")));
    kids.push(para(why));
    kids.push(para(tx.closing, 200));
    kids.push(new P({ spacing: { after: 400 }, children: [new R({ text: tx.regards, size: 22 })] }));
    kids.push(new P({ children: [new R({ text: p.name || "", size: 22 })] }));

    var doc = new docx.Document({
      creator: "",
      styles: { default: { document: { run: { font: FONT, size: 22 } } } },
      sections: [{ properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 1300, bottom: 1200, left: 1400, right: 1400 } } }, children: kids }],
    });
    return { doc: doc, notes: notes, selection: sel };
  }

  function safeName(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  }

  function fileName(kind, profile, offer, l) {
    var who = safeName(((profile.personal || {}).name) || "CV");
    return [kind === "letter" ? "Cover_Letter" : "CV", who, safeName(offer.company), lang(l).toUpperCase()].filter(Boolean).join("_") + ".docx";
  }

  return { selectContent: selectContent, buildCV: buildCV, buildLetter: buildLetter, fileName: fileName, FOCUS: FOCUS };
});
