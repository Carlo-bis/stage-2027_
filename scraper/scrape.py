#!/usr/bin/env python3
"""Stage 2027: raccolta giornaliera di offerte di summer internship da fonti ufficiali.

Uso:
    python scraper/scrape.py                  # esecuzione completa (richiede rete)
    python scraper/scrape.py --offline        # solo lead manuali, nessuna richiesta di rete

Legge:   data/sources.json, data/manual_leads.json
Scrive:  site/data/offers.json  (letto dalla dashboard)
         build/new_offers.md    (solo se ci sono offerte nuove, usato per l'avviso)

Usa solo la libreria standard di Python. Per le pagine HTML controlla robots.txt
e salta i siti che non consentono l'accesso automatico.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib import parse, request, robotparser

ROOT = Path(__file__).resolve().parent.parent
SOURCES_FILE = ROOT / "data" / "sources.json"
MANUAL_FILE = ROOT / "data" / "manual_leads.json"
OUT_FILE = ROOT / "site" / "data" / "offers.json"

UA = "stage-2027-tracker/1.0 (ricerca personale di stage; accesso rispettoso, 1 volta al giorno)"
CLOSED_KEEP_DAYS = 45

# ---------------------------------------------------------------- riconoscimento

INTERN_RE = re.compile(
    r"\b(intern|interns|internship|internships|stage|stages|stagista|stagiaire|praktikum|praktikant|"
    r"summer analyst|summer associate|summer program(?:me)?|summer placement|werkstudent)\b",
    re.I,
)
LUGANO_RE = re.compile(r"\b(lugano|ticino|bellinzona|locarno|chiasso|mendrisio|massagno|paradiso|manno)\b", re.I)
MILANO_RE = re.compile(r"\b(milan|milano|mailand)\b", re.I)
CH_RE = re.compile(
    r"\b(switzerland|schweiz|svizzera|suisse|zurich|zürich|zurigo|geneva|genève|ginevra|genf|basel|basilea|"
    r"bern|berna|lausanne|losanna|zug|zugo|baar|pfäffikon|pfaffikon|lucerne|luzern|st\.? gallen|winterthur|"
    r"gland|nyon)\b",
    re.I,
)
REL_RE = re.compile(
    r"(financ|invest|bank|wealth|asset|portfolio|equity|credit|treasur|valuation|m&a|capital|venture|"
    r"private (?:equity|banking)|risk|quant|trading|markets|fund|advis|analyst|fintech|payment|"
    r"finanz|investiment|banc|gestione)",
    re.I,
)

DUR_RE = re.compile(
    r"(\d{1,2})(?:\s*(?:-|–|to|a|bis)\s*(\d{1,2}))?[\s-]*"
    r"(months?|mesi|mese|monate|monaten|monat|mois|weeks?|settimane|settimana|wochen|woche|semaines?)\b",
    re.I,
)
DUR_CONTEXT_RE = re.compile(
    r"(intern|stage|duration|durata|programme|program|placement|period|periodo|dauer|dura|lasting|lasts)", re.I
)
SUMMER_RE = re.compile(
    r"(summer\s+(?:intern|analyst|associate|program|placement|20\d\d)|summer\s*20\d\d|estate\s+20\d\d|"
    r"stage\s+estiv|sommerpraktik|giugno|june|luglio|july)",
    re.I,
)
NOT_SUMMER_RE = re.compile(
    r"(off[- ]cycle|"
    r"(?:start(?:s|ing)?|begin(?:s|ning)?|from|dal|ab|inizio|partenza)\s*(?:date\s*)?(?:in\s+|of\s+|:)?\s*"
    r"(?:early\s+)?(?:january|february|march|april|gennaio|febbraio|marzo|aprile|januar|februar|märz)\b)",
    re.I,
)
PROCESS_RE = re.compile(
    r"(assessment|interview|colloqui|colloquio|case study|hirevue|online test|test online|video interview|"
    r"assessment centre|assessment center|psychometric)",
    re.I,
)
DEADLINE_KW_RE = re.compile(
    r"(deadline|apply (?:by|before)|applications? (?:close|closes|closing|due|until)|closing date|scadenza|"
    r"candidature? (?:entro|fino al|chiud\w+)|entro il|bewerbungsfrist|bewerben sie sich bis|date limite)",
    re.I,
)

MONTHS = {
    "january": 1, "jan": 1, "gennaio": 1, "januar": 1, "janvier": 1,
    "february": 2, "feb": 2, "febbraio": 2, "februar": 2, "février": 2,
    "march": 3, "mar": 3, "marzo": 3, "märz": 3, "mars": 3,
    "april": 4, "apr": 4, "aprile": 4, "avril": 4,
    "may": 5, "maggio": 5, "mai": 5,
    "june": 6, "jun": 6, "giugno": 6, "juni": 6, "juin": 6,
    "july": 7, "jul": 7, "luglio": 7, "juli": 7, "juillet": 7,
    "august": 8, "aug": 8, "agosto": 8, "août": 8,
    "september": 9, "sep": 9, "sept": 9, "settembre": 9, "septembre": 9,
    "october": 10, "oct": 10, "ottobre": 10, "oktober": 10, "octobre": 10,
    "november": 11, "nov": 11, "novembre": 11,
    "december": 12, "dec": 12, "dicembre": 12, "dezember": 12, "décembre": 12,
}
DATE_PATTERNS = [
    (re.compile(r"(\d{4})-(\d{2})-(\d{2})"), "ymd"),
    (re.compile(r"(\d{1,2})(?:st|nd|rd|th|°)?\s+(?:of\s+)?([A-Za-zÀ-ÿ]+)\.?,?\s+(\d{4})"), "dmy"),
    (re.compile(r"([A-Za-zÀ-ÿ]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})"), "mdy"),
    (re.compile(r"(\d{1,2})[./](\d{1,2})[./](\d{4})"), "dmy_num"),
]


def parse_date(text: str) -> str | None:
    """Primo giorno trovato nel testo, come YYYY-MM-DD, oppure None."""
    best = None
    for pattern, kind in DATE_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        try:
            if kind == "ymd":
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            elif kind == "dmy":
                d, mo, y = int(m.group(1)), MONTHS.get(m.group(2).lower()), int(m.group(3))
            elif kind == "mdy":
                mo, d, y = MONTHS.get(m.group(1).lower()), int(m.group(2)), int(m.group(3))
            else:
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if not mo:
                continue
            value = dt.date(y, mo, d).isoformat()
        except (ValueError, TypeError):
            continue
        if best is None or m.start() < best[0]:
            best = (m.start(), value)
    return best[1] if best else None


def extract_deadline(text: str) -> str | None:
    for m in DEADLINE_KW_RE.finditer(text):
        found = parse_date(text[m.end(): m.end() + 90])
        if found:
            return found
    return None


def parse_durations(text: str, require_context: bool = True) -> list[float]:
    """Durate in mesi citate nel testo. Con require_context ignora numeri lontani da parole come 'stage'."""
    out: list[float] = []
    for m in DUR_RE.finditer(text):
        unit = m.group(3).lower()
        weeks = unit.startswith(("week", "settiman", "woche", "semain"))
        if require_context:
            ctx = text[max(0, m.start() - 80): m.end() + 80]
            if not DUR_CONTEXT_RE.search(ctx):
                continue
        for raw in (m.group(1), m.group(2)):
            if raw is None:
                continue
            v = int(raw)
            if weeks:
                if 3 <= v <= 52:
                    out.append(round(v / 4.345, 1))
            elif 1 <= v <= 24:
                out.append(float(v))
    return out


def duration_ok(months: list[float]) -> bool | None:
    if not months:
        return None
    if max(months) <= 3.05:
        return True
    if min(months) > 3.05:
        return False
    return None


def season_ok(text: str) -> bool | None:
    if NOT_SUMMER_RE.search(text) and not re.search(r"summer\s+(?:intern|analyst|associate|program)", text, re.I):
        return False
    if SUMMER_RE.search(text):
        return True
    return None


def location_class(location: str) -> str:
    if not location.strip():
        return "sconosciuta"
    if LUGANO_RE.search(location):
        return "lugano"
    if MILANO_RE.search(location):
        return "milano"
    if CH_RE.search(location):
        return "svizzera"
    return "fuori"


FINANCE_CATEGORIES = {"banca", "asset_management", "vc_pe", "family_office"}
NON_FIN_RE = re.compile(
    r"(software|engineer|developer|devops|sviluppator|designer|\bhr\b|human resources|recruit|legal|counsel|"
    r"marketing|communication|facilit|\bit support\b|cyber|infrastructure)",
    re.I,
)


def relevance(title: str, description: str, category: str = "") -> str:
    if REL_RE.search(title):
        return "alta"
    hits = {m.group(0).lower() for m in REL_RE.finditer(description[:1500])}
    if len(hits) >= 3:
        return "media"
    # uno stage generico presso una banca o un fondo e' comunque un ruolo di finanza,
    # a meno che il titolo indichi chiaramente un altro mestiere
    if category in FINANCE_CATEGORIES and not NON_FIN_RE.search(title):
        return "media"
    return "bassa"


def extract_process(text: str, limit: int = 2) -> str:
    sentences = re.split(r"(?<=[.!?])\s+|\n+", text)
    picked = []
    for s in sentences:
        s = s.strip()
        if 15 <= len(s) <= 300 and PROCESS_RE.search(s):
            picked.append(s)
        if len(picked) >= limit:
            break
    return " ".join(picked)


def summarize(text: str, limit: int = 280) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut + "…"


def classify(raw: dict) -> dict:
    """Aggiunge a un'offerta grezza i campi calcolati e il verdetto (match / check / excluded)."""
    title = raw.get("title", "")
    location = raw.get("location", "")
    description = raw.get("description", "")
    explicit = " ".join(filter(None, [raw.get("duration_text"), raw.get("period_text")]))
    blob = " ".join(filter(None, [title, raw.get("commitment", ""), description, explicit, raw.get("summary", "")]))

    months = parse_durations(blob)
    if raw.get("duration_text"):
        months = parse_durations(raw["duration_text"], require_context=False) or months
    d_ok = duration_ok(months)
    s_ok = season_ok(" ".join(filter(None, [title, explicit, description[:3000]])))
    loc = location_class(location)
    is_intern = bool(INTERN_RE.search(title) or INTERN_RE.search(raw.get("commitment", "")) or raw.get("force_intern"))

    excluded = []
    if not is_intern:
        excluded.append("non è uno stage")
    if loc == "fuori":
        excluded.append(f"sede fuori criteri ({location})")
    if d_ok is False:
        excluded.append("durata " + ("oltre i 3 mesi: " + "/".join(f"{m:g}" for m in months) + " mesi"))
    if s_ok is False:
        excluded.append("partenza non estiva")

    unknown = []
    if loc == "sconosciuta":
        unknown.append("sede da verificare")
    if d_ok is None:
        unknown.append("durata non indicata o ambigua")
    if s_ok is None:
        unknown.append("periodo non indicato")

    verdict = "excluded" if excluded else ("match" if not unknown else "check")
    return {
        "location_class": loc,
        "duration_months": sorted(set(months)),
        "duration_ok": d_ok,
        "summer_ok": s_ok,
        "relevance": relevance(title, description, raw.get("category", "")),
        "verdict": verdict,
        "reasons": excluded if excluded else unknown,
    }


# ---------------------------------------------------------------- rete e HTML


class Blocked(Exception):
    """robots.txt non consente l'accesso automatico."""


def http_get(url: str, timeout: int = 25, data: bytes | None = None, headers: dict | None = None) -> str:
    req = request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "*/*", **(headers or {})})
    with request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read(5_000_000)
        charset = resp.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


_robots: dict[str, robotparser.RobotFileParser | None] = {}


def allowed_by_robots(url: str) -> bool:
    p = parse.urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = robotparser.RobotFileParser()
        try:
            rp.parse(http_get(base + "/robots.txt", timeout=10).splitlines())
            _robots[base] = rp
        except Exception:
            _robots[base] = None  # robots.txt non raggiungibile: si procede
    rp = _robots[base]
    return True if rp is None else rp.can_fetch(UA, url)


class _TextParser(HTMLParser):
    BLOCK = {"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_to_text(markup: str) -> str:
    parser = _TextParser()
    parser.feed(markup or "")
    text = "".join(parser.parts)
    text = re.sub(r"[ \t\xa0]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.links.append((self._href, re.sub(r"\s+", " ", "".join(self._text)).strip()))
            self._href = None


def extract_links(markup: str, base_url: str) -> list[tuple[str, str]]:
    parser = _LinkParser()
    parser.feed(markup)
    out = []
    for href, text in parser.links:
        if not href or href.startswith(("#", "mailto:", "javascript:", "tel:")):
            continue
        out.append((parse.urljoin(base_url, href), text))
    return out


# ---------------------------------------------------------------- adattatori per fonte
# Ogni adattatore restituisce una lista di dict con: title, location, url, published, description, ext_id


def fetch_greenhouse(src: dict) -> list[dict]:
    token = src["params"]["token"]
    data = json.loads(http_get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"))
    out = []
    for j in data.get("jobs", []):
        out.append({
            "title": j.get("title", ""),
            "location": (j.get("location") or {}).get("name", ""),
            "url": j.get("absolute_url", ""),
            "published": (j.get("first_published") or j.get("updated_at") or "")[:10],
            "deadline": (j.get("application_deadline") or "")[:10] or None,
            "description": html_to_text(html.unescape(j.get("content") or "")),
            "ext_id": str(j.get("id", "")),
        })
    return out


def fetch_lever(src: dict) -> list[dict]:
    company = src["params"]["company"]
    data = json.loads(http_get(f"https://api.lever.co/v0/postings/{company}?mode=json"))
    out = []
    for j in data:
        cats = j.get("categories") or {}
        desc = j.get("descriptionPlain") or html_to_text(j.get("description") or "")
        for block in j.get("lists") or []:
            desc += "\n" + block.get("text", "") + ": " + html_to_text(block.get("content", ""))
        created = j.get("createdAt")
        published = dt.datetime.fromtimestamp(created / 1000, tz=dt.timezone.utc).date().isoformat() if created else ""
        out.append({
            "title": j.get("text", ""),
            "commitment": cats.get("commitment", ""),
            "location": cats.get("location") or ", ".join(cats.get("allLocations") or []),
            "url": j.get("hostedUrl", ""),
            "published": published,
            "description": desc,
            "ext_id": j.get("id", ""),
        })
    return out


def fetch_recruitee(src: dict) -> list[dict]:
    company = src["params"]["company"]
    data = json.loads(http_get(f"https://{company}.recruitee.com/api/offers/"))
    out = []
    for j in data.get("offers", []):
        loc = j.get("location") or ", ".join(filter(None, [j.get("city"), j.get("country")]))
        out.append({
            "title": j.get("title", ""),
            "commitment": str(j.get("employment_type_code") or j.get("employment_type") or ""),
            "location": loc,
            "url": j.get("careers_url", ""),
            "published": (j.get("published_at") or "")[:10],
            "description": html_to_text((j.get("description") or "") + "\n" + (j.get("requirements") or "")),
            "ext_id": str(j.get("id", "")),
        })
    return out


def fetch_workday(src: dict) -> list[dict]:
    p = src["params"]
    host, tenant, site = p["host"], p["tenant"], p["site"]
    api = f"https://{host}/wday/cxs/{tenant}/{site}/jobs"
    out, offset = [], 0
    for _ in range(5):
        body = json.dumps({"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": p.get("search", "intern")})
        data = json.loads(http_get(api, data=body.encode(), headers={"Content-Type": "application/json", "Accept": "application/json"}))
        posts = data.get("jobPostings", [])
        for j in posts:
            out.append({
                "title": j.get("title", ""),
                "location": j.get("locationsText", ""),
                "url": f"https://{host}/en-US/{site}{j.get('externalPath', '')}",
                "published": "",
                "description": " ".join(j.get("bulletFields") or []),
                "ext_id": j.get("externalPath", ""),
            })
        offset += 20
        if not posts or offset >= data.get("total", 0):
            break
    return out


def guess_location(text: str) -> str:
    head = text[:2500]
    for regex in (LUGANO_RE, MILANO_RE, CH_RE):
        m = regex.search(head)
        if m:
            return m.group(0)
    return ""


def fetch_html_links(src: dict) -> list[dict]:
    p = src["params"]
    url = p["url"]
    if not allowed_by_robots(url):
        raise Blocked("robots.txt non consente l'accesso automatico")
    page = http_get(url)
    seen, items = set(), []
    for href, text in extract_links(page, url):
        if href in seen or not (INTERN_RE.search(text) or INTERN_RE.search(parse.unquote(href))):
            continue
        seen.add(href)
        items.append((href, text))
    out = []
    for href, text in items[: p.get("limit", 15)]:
        item = {"title": text or "Stage", "location": "", "url": href, "published": "", "description": "", "ext_id": href}
        if p.get("detail", True) and allowed_by_robots(href):
            try:
                time.sleep(0.7)
                body = html_to_text(http_get(href))
                item["description"] = body[:6000]
                item["location"] = guess_location(body)
            except Exception:
                pass
        out.append(item)
    return out


ADAPTERS = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "recruitee": fetch_recruitee,
    "workday": fetch_workday,
    "html_links": fetch_html_links,
}


# ---------------------------------------------------------------- pipeline


def offer_id(source_id: str, key: str) -> str:
    return hashlib.sha1(f"{source_id}|{key}".encode()).hexdigest()[:12]


def build_offer(raw: dict, src: dict, origin: str, today: str) -> dict:
    description = raw.get("description", "")
    deadline = raw.get("deadline") or extract_deadline(description)
    offer = {
        "id": offer_id(src["id"], raw.get("ext_id") or raw.get("url") or raw.get("title", "")),
        "source_id": src["id"],
        "origin": origin,
        "company": raw.get("company") or src["name"],
        "category": src.get("category", "altro"),
        "title": raw.get("title", "").strip(),
        "location": raw.get("location", "").strip(),
        "url": raw.get("url", ""),
        "published": raw.get("published") or None,
        "deadline": deadline,
        "deadline_note": raw.get("deadline_note", ""),
        "duration_text": raw.get("duration_text", ""),
        "period_text": raw.get("period_text", ""),
        "process_text": raw.get("process_text") or extract_process(description),
        "requirements": raw.get("requirements", ""),
        "summary": raw.get("summary") or summarize(description),
        "description": description[:1800],
        "confidence": raw.get("confidence", ""),
        "checked_on": raw.get("checked_on", today if origin == "auto" else ""),
    }
    offer.update(classify({**raw, "title": offer["title"], "location": offer["location"], "description": description}))
    return offer


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def run(offline: bool, today: str | None = None) -> dict:
    today = today or dt.date.today().isoformat()
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    sources = load_json(SOURCES_FILE, {"sources": []})["sources"]
    manual = load_json(MANUAL_FILE, {"leads": []})["leads"]
    previous = load_json(OUT_FILE, {})
    prev_offers = {o["id"]: o for o in previous.get("offers", [])}

    offers: dict[str, dict] = {}
    excluded: dict[str, dict] = {}
    statuses = []
    ok_sources = set()

    for src in sources:
        status = {k: src.get(k) for k in ("id", "name", "category", "city", "type", "careers_url", "verified", "note", "opens_hint")}
        status.update({"count": 0, "error": "", "checked_at": now})
        adapter = ADAPTERS.get(src["type"])
        if src["type"] == "manual" or not src.get("enabled", True):
            status["run"] = "manuale"
        elif adapter is None:
            status["run"] = "errore"
            status["error"] = f"tipo di fonte sconosciuto: {src['type']}"
        elif offline:
            status["run"] = "non eseguita"
        else:
            try:
                raws = adapter(src)
                ok_sources.add(src["id"])
                status["run"] = "ok"
                status["count"] = len(raws)
                for raw in raws:
                    o = build_offer(raw, src, "auto", today)
                    (excluded if o["verdict"] == "excluded" else offers)[o["id"]] = o
            except Blocked as e:
                status["run"] = "bloccata"
                status["error"] = str(e)
            except Exception as e:  # una fonte rotta non deve fermare le altre
                status["run"] = "errore"
                status["error"] = f"{type(e).__name__}: {e}"[:300]
            time.sleep(0.5)
        statuses.append(status)

    src_by_id = {s["id"]: s for s in sources}
    for lead in manual:
        src = src_by_id.get(lead.get("source_id"), {"id": lead.get("source_id", "manuale"), "name": lead["company"], "category": lead.get("category", "altro")})
        src = {**src, "category": lead.get("category", src.get("category", "altro")), "name": lead["company"]}
        key = lead.get("key") or lead["url"] + "|" + lead.get("location", "")
        o = build_offer({**lead, "ext_id": key}, src, "manuale", today)
        (excluded if o["verdict"] == "excluded" else offers)[o["id"]] = o

    # prima volta vista / ultima volta vista
    for oid, o in offers.items():
        old = prev_offers.get(oid)
        o["first_seen"] = old["first_seen"] if old else today
        o["last_seen"] = today
    new_ids = [oid for oid, o in offers.items() if oid not in prev_offers and previous]

    # offerte sparite da fonti che hanno risposto: segnate come chiuse
    closed = [c for c in previous.get("closed", []) if (dt.date.fromisoformat(today) - dt.date.fromisoformat(c.get("closed_on", today))).days <= CLOSED_KEEP_DAYS]
    for oid, old in prev_offers.items():
        if oid not in offers and old.get("source_id") in ok_sources and old.get("origin") == "auto":
            closed.append({**old, "closed_on": today})

    result = {
        "schema": 1,
        "generated_at": now,
        "offers": sorted(offers.values(), key=lambda o: (o["deadline"] or "9999", {"lugano": 0, "milano": 1, "svizzera": 2}.get(o["location_class"], 3), o["company"])),
        "excluded": [
            {k: o[k] for k in ("id", "company", "title", "location", "url", "reasons", "origin")}
            for o in sorted(excluded.values(), key=lambda o: o["company"])
        ],
        "closed": closed,
        "sources": statuses,
        "new_ids": new_ids,
    }
    return result


def write_notification(result: dict, path: Path, site_url: str, mention: str) -> bool:
    fresh = [o for o in result["offers"] if o["id"] in set(result["new_ids"]) and o["relevance"] != "bassa"]
    if not fresh:
        if path.exists():
            path.unlink()
        return False
    lines = []
    if mention:
        lines.append(f"@{mention} ci sono nuove offerte di stage.\n")
    for o in fresh:
        where = o["location"] or "sede da verificare"
        dl = f", scadenza {o['deadline']}" if o["deadline"] else ""
        flag = "" if o["verdict"] == "match" else f" _(da verificare: {', '.join(o['reasons'])})_"
        lines.append(f"- **{o['company']}**: {o['title']} ({where}{dl}) [apri l'offerta]({o['url']}){flag}")
    if site_url:
        lines.append(f"\nDashboard: {site_url}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="non fare richieste di rete: solo lead manuali")
    ap.add_argument("--notify-out", default="", help="file Markdown da scrivere se ci sono offerte nuove")
    ap.add_argument("--site-url", default="", help="URL della dashboard da citare nell'avviso")
    ap.add_argument("--mention", default="", help="utente GitHub da menzionare nell'avviso")
    ap.add_argument("--out", default=str(OUT_FILE))
    args = ap.parse_args(argv)

    result = run(args.offline)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    n_ok = sum(1 for s in result["sources"] if s["run"] == "ok")
    n_err = [s for s in result["sources"] if s["run"] in ("errore", "bloccata")]
    print(f"Offerte: {len(result['offers'])} (match {sum(o['verdict']=='match' for o in result['offers'])}, "
          f"da verificare {sum(o['verdict']=='check' for o in result['offers'])}), scartate {len(result['excluded'])}, "
          f"nuove {len(result['new_ids'])}, chiuse {len(result['closed'])}")
    print(f"Fonti automatiche riuscite: {n_ok}; con problemi: {len(n_err)}")
    for s in n_err:
        print(f"  - {s['name']}: {s['run']} ({s['error']})")
    if args.notify_out:
        sent = write_notification(result, Path(args.notify_out), args.site_url, args.mention)
        print("Avviso: " + ("scritto" if sent else "nessuna offerta nuova"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
