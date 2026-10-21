"""Test dello scraper. Si lanciano con:  python -m unittest discover -s scraper/tests -v

I dati di prova (fixture) sono sintetici: ricalcano la struttura delle risposte reali di
Greenhouse e Lever osservata il 20 ottobre 2026, ma i contenuti sono inventati.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import scrape  # noqa: E402

GREENHOUSE = {
    "jobs": [
        {"id": 1, "title": "Legal Counsel Intern - Regulatory (6 months)", "absolute_url": "https://x/1",
         "location": {"name": "Milan, Italy"}, "first_published": "2026-10-08T00:01:55-04:00",
         "content": "&lt;p&gt;Stage of 6 months in our legal team.&lt;/p&gt;"},
        {"id": 2, "title": "Finance Summer Intern 2027", "absolute_url": "https://x/2",
         "location": {"name": "Milan, Italy"}, "first_published": "2026-10-09T10:00:00-04:00",
         "content": "&lt;p&gt;Summer internship, 10 weeks from June 2027. Apply by 15 November 2026. "
                    "The process has a video interview and a case study.&lt;/p&gt;"},
        {"id": 3, "title": "Risk Analyst", "absolute_url": "https://x/3", "location": {"name": "Milan, Italy"},
         "first_published": "2026-10-01T10:00:00-04:00", "content": ""},
    ]
}
LEVER = [
    {"id": "abc", "text": "Quant Intern", "hostedUrl": "https://l/abc", "createdAt": 1777551217923,
     "categories": {"location": "Zurich", "commitment": "Intern", "allLocations": ["Zurich"]},
     "descriptionPlain": "Internship of 3 months in summer 2027.", "lists": []},
]
LINKS_PAGE = """<html><body><a href="/job/1">Milan - Structured Loans Internship</a>
<a href="/job/2">Senior Manager</a><a href="mailto:x@y.z">mail</a></body></html>"""
DETAIL_PAGE = "<html><body><p>Location: Milano. Internship duration: 6 months, starting in February 2027.</p></body></html>"


class ParsingTests(unittest.TestCase):
    def test_durations(self):
        self.assertEqual(scrape.parse_durations("Internship of 6 months"), [6.0])
        self.assertEqual(scrape.parse_durations("stage di 10 settimane"), [2.3])
        self.assertEqual(scrape.parse_durations("Internship 3-6 months"), [3.0, 6.0])
        self.assertEqual(scrape.parse_durations("5 years of experience, 6 months notice"), [])  # niente contesto
        self.assertEqual(scrape.parse_durations("9-10 settimane", require_context=False), [2.1, 2.3])

    def test_duration_ok(self):
        self.assertTrue(scrape.duration_ok([2.3]))
        self.assertTrue(scrape.duration_ok([3.0]))
        self.assertFalse(scrape.duration_ok([6.0]))
        self.assertIsNone(scrape.duration_ok([3.0, 6.0]))  # intervallo ambiguo: da verificare
        self.assertIsNone(scrape.duration_ok([]))

    def test_dates(self):
        self.assertEqual(scrape.parse_date("30 October 2026"), "2026-10-30")
        self.assertEqual(scrape.parse_date("October 30, 2026"), "2026-10-30")
        self.assertEqual(scrape.parse_date("30 ottobre 2026"), "2026-10-30")
        self.assertEqual(scrape.parse_date("30.10.2026"), "2026-10-30")
        self.assertEqual(scrape.parse_date("2026-10-30"), "2026-10-30")
        self.assertIsNone(scrape.parse_date("no date here"))
        self.assertEqual(scrape.extract_deadline("Intro. Apply by 15 November 2026."), "2026-11-15")
        self.assertEqual(scrape.extract_deadline("Scadenza: 3 dicembre 2026"), "2026-12-03")
        self.assertIsNone(scrape.extract_deadline("Starts 15 June 2027"))  # data senza parola chiave

    def test_location(self):
        self.assertEqual(scrape.location_class("Lugano, Switzerland"), "lugano")
        self.assertEqual(scrape.location_class("Milan, Italy"), "milano")
        self.assertEqual(scrape.location_class("Zürich"), "svizzera")
        self.assertEqual(scrape.location_class("Rome, Italy"), "fuori")
        self.assertEqual(scrape.location_class(""), "sconosciuta")

    def test_html(self):
        text = scrape.html_to_text("<div>Ciao <b>mondo</b><script>x=1</script></div><p>Due</p>")
        self.assertIn("Ciao mondo", text)
        self.assertNotIn("x=1", text)
        links = scrape.extract_links(LINKS_PAGE, "https://site.example/list")
        self.assertIn(("https://site.example/job/1", "Milan - Structured Loans Internship"), links)
        self.assertTrue(all(not h.startswith("mailto") for h, _ in links))


class ClassifyTests(unittest.TestCase):
    def c(self, **kw):
        base = {"title": "Finance Intern", "location": "Lugano", "description": ""}
        base.update(kw)
        return scrape.classify(base)

    def test_match(self):
        r = self.c(title="Summer Internship 2027", description="Duration: 10 weeks, June to August 2027.")
        self.assertEqual(r["verdict"], "match")

    def test_excluded_six_months(self):
        r = self.c(title="Finance Intern (6 months)", description="Summer 2027")
        self.assertEqual(r["verdict"], "excluded")
        self.assertTrue(any("durata" in x for x in r["reasons"]))

    def test_excluded_offcycle_and_location(self):
        self.assertEqual(self.c(description="Off-cycle internship 2027")["verdict"], "excluded")
        self.assertEqual(self.c(location="Rome, Italy")["verdict"], "excluded")
        self.assertEqual(self.c(title="Senior Risk Manager")["verdict"], "excluded")

    def test_check_when_unknown(self):
        r = self.c(title="Quant Intern", description="Great team.")
        self.assertEqual(r["verdict"], "check")
        self.assertIn("durata non indicata o ambigua", r["reasons"])
        self.assertEqual(self.c(location="")["verdict"], "check")

    def test_range_is_check(self):
        self.assertEqual(self.c(description="Internship of 3-6 months, summer 2027.")["verdict"], "check")

    def test_relevance(self):
        self.assertEqual(scrape.relevance("Investment Banking Intern", ""), "alta")
        self.assertEqual(scrape.relevance("Office Assistant", "tea coffee"), "bassa")


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "sources.json").write_text(json.dumps({"sources": [
            {"id": "gh", "name": "GH Co", "category": "fintech", "city": "Milano", "type": "greenhouse", "params": {"token": "t"}},
            {"id": "lv", "name": "LV Co", "category": "fintech", "city": "Zurigo", "type": "lever", "params": {"company": "c"}},
            {"id": "hl", "name": "HL Bank", "category": "banca", "city": "Milano", "type": "html_links", "params": {"url": "https://site.example/list"}},
            {"id": "bad", "name": "Rotta", "category": "banca", "city": "-", "type": "lever", "params": {"company": "broken"}},
            {"id": "man", "name": "Manuale", "category": "banca", "city": "-", "type": "manual"},
        ]}))
        (self.tmp / "manual.json").write_text(json.dumps({"leads": [
            {"company": "BR", "source_id": "man", "category": "asset_management", "key": "k1", "title": "Summer Internship 2027",
             "location": "Zurigo", "url": "https://br/1", "duration_text": "8 settimane", "period_text": "Giugno-agosto 2027", "deadline": "2026-10-30"},
        ]}))
        self.out = self.tmp / "offers.json"
        self.old = (scrape.SOURCES_FILE, scrape.MANUAL_FILE, scrape.OUT_FILE, scrape.http_get, scrape.allowed_by_robots, scrape.time.sleep)
        scrape.SOURCES_FILE, scrape.MANUAL_FILE, scrape.OUT_FILE = self.tmp / "sources.json", self.tmp / "manual.json", self.out

        def fake_get(url, **kw):
            if "greenhouse" in url:
                return json.dumps(GREENHOUSE)
            if "lever.co/v0/postings/c" in url:
                return json.dumps(LEVER)
            if "broken" in url:
                raise OSError("boom")
            if url.endswith("/job/1"):
                return DETAIL_PAGE
            return LINKS_PAGE

        scrape.http_get = fake_get
        scrape.allowed_by_robots = lambda url: True
        scrape.time.sleep = lambda s: None

    def tearDown(self):
        (scrape.SOURCES_FILE, scrape.MANUAL_FILE, scrape.OUT_FILE, scrape.http_get, scrape.allowed_by_robots, scrape.time.sleep) = self.old

    def test_full_run(self):
        res = scrape.run(offline=False, today="2026-10-21")
        by_title = {o["title"]: o for o in res["offers"]}
        self.assertIn("Finance Summer Intern 2027", by_title)
        gh = by_title["Finance Summer Intern 2027"]
        self.assertEqual(gh["verdict"], "match")
        self.assertEqual(gh["deadline"], "2026-11-15")
        self.assertIn("interview", gh["process_text"].lower())
        self.assertEqual(gh["published"], "2026-10-09")
        self.assertIn("Quant Intern", by_title)
        self.assertEqual(by_title["Quant Intern"]["verdict"], "match")
        self.assertIn("Summer Internship 2027", by_title)  # lead manuale
        excluded = {e["title"] for e in res["excluded"]}
        self.assertIn("Legal Counsel Intern - Regulatory (6 months)", excluded)
        self.assertIn("Milan - Structured Loans Internship", excluded)  # 6 mesi, partenza febbraio
        self.assertNotIn("Risk Analyst", by_title)
        runs = {s["id"]: s["run"] for s in res["sources"]}
        self.assertEqual(runs, {"gh": "ok", "lv": "ok", "hl": "ok", "bad": "errore", "man": "manuale"})
        self.assertEqual(res["new_ids"], [])  # prima esecuzione: nessun avviso

    def test_new_and_closed(self):
        first = scrape.run(offline=False, today="2026-10-21")
        self.out.write_text(json.dumps(first))
        scrape.http_get_orig = scrape.http_get
        gh2 = {"jobs": GREENHOUSE["jobs"][:1] + [{"id": 9, "title": "Summer Intern Equity Research 2027", "absolute_url": "https://x/9",
               "location": {"name": "Milan, Italy"}, "first_published": "2026-10-22T10:00:00-04:00",
               "content": "&lt;p&gt;Summer 2027, 10 weeks internship.&lt;/p&gt;"}]}
        prev = scrape.http_get

        def second(url, **kw):
            return json.dumps(gh2) if "greenhouse" in url else prev(url, **kw)

        scrape.http_get = second
        res = scrape.run(offline=False, today="2026-10-22")
        new_titles = {o["title"] for o in res["offers"] if o["id"] in res["new_ids"]}
        self.assertEqual(new_titles, {"Summer Intern Equity Research 2027"})
        self.assertEqual([c["title"] for c in res["closed"]], ["Finance Summer Intern 2027"])
        first_seen = {o["title"]: o["first_seen"] for o in res["offers"]}
        self.assertEqual(first_seen["Quant Intern"], "2026-10-21")
        note = self.tmp / "note.md"
        self.assertTrue(scrape.write_notification(res, note, "https://s/", "carlo"))
        body = note.read_text()
        self.assertIn("@carlo", body)
        self.assertIn("Equity Research", body)

    def test_failed_source_does_not_close_offers(self):
        first = scrape.run(offline=False, today="2026-10-21")
        self.out.write_text(json.dumps(first))
        prev = scrape.http_get

        def second(url, **kw):
            if "greenhouse" in url:
                raise OSError("rete giù")
            return prev(url, **kw)

        scrape.http_get = second
        res = scrape.run(offline=False, today="2026-10-22")
        self.assertEqual(res["closed"], [])
        self.assertEqual({s["id"]: s["run"] for s in res["sources"]}["gh"], "errore")

    def test_offline(self):
        res = scrape.run(offline=True, today="2026-10-21")
        self.assertEqual([o["company"] for o in res["offers"]], ["BR"])
        self.assertEqual({s["run"] for s in res["sources"]} - {"manuale", "non eseguita"}, set())


if __name__ == "__main__":
    unittest.main()
