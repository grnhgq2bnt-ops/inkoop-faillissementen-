#!/usr/bin/env python3
"""
Download de KBO daily open-data zip (probeert laatste 5 dagen) en extraheer
ondernemingsnummers uit faillissementen. Schrijft unieke VAT's naar
data/raw/vats.txt (overschrijft bestaand bestand NIET als er niets gevonden wordt).

Verbeteringen t.o.v. origineel:
- Probeert 5 dagen in plaats van 3 (weekends/feestdagen)
- Bredere zoekterm: ook 'ontbinding', 'liquidat', 'vereffening', 'insolvab'
- Valideert VAT-formaat voor opname
- Overschrijft vats.txt NIET als run mislukt (veiliger voor CI)
- Logt hoeveel VATs er nieuw/totaal zijn
"""

import csv
import datetime as dt
import io
import os
import re
import sys
import urllib.request
import zipfile

BASE_URL = "https://kbopub.economie.fgov.be/kbo-open-data/daily/KBO_PUBLIC_DAILY_{date}.zip"
OUT_PATH = os.path.join("data", "raw", "vats.txt")

# Zoektermen voor faillissementen en aanverwante statussen
KEYWORDS = ("faill", "ontbind", "liquidat", "vereffening", "insolvab", "faillite", "bankrupt")

# Geldig Belgisch ondernemingsnummer: BE + 10 cijfers, of enkel 10 cijfers
VAT_RE = re.compile(r"^(?:BE\s*0?\d{9}|0\d{9}|\d{10})$", re.IGNORECASE)


def normalize_vat(raw: str) -> str | None:
    """Normaliseer naar BE0XXX.XXX.XXX formaat of None als ongeldig."""
    s = raw.strip().replace(" ", "").replace(".", "").replace("-", "")
    if re.fullmatch(r"BE0\d{9}", s, re.IGNORECASE):
        return s.upper()
    if re.fullmatch(r"BE\d{9}", s, re.IGNORECASE):
        return ("BE0" + s[2:]).upper()
    if re.fullmatch(r"0\d{9}", s):
        return "BE" + s
    if re.fullmatch(r"\d{10}", s):
        return "BE" + s
    return None


def fetch_zip(date_str: str) -> bytes:
    url = BASE_URL.format(date=date_str)
    print(f"[info] Probeer {url} ...", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": "faillissementenkaart/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status}")
        return resp.read()


def find_csvs(raw: bytes) -> list[io.TextIOWrapper]:
    """Geef alle CSV-bestanden terug uit de zip."""
    zf = zipfile.ZipFile(io.BytesIO(raw))
    result = []
    for name in zf.namelist():
        if name.lower().endswith(".csv"):
            result.append(io.TextIOWrapper(zf.open(name), encoding="utf-8", errors="replace", newline=""))
    if not result:
        raise RuntimeError("Geen CSV in zip")
    return result


def has_keyword(text: str) -> bool:
    tl = text.lower()
    return any(kw in tl for kw in KEYWORDS)


def extract_vats(fh: io.TextIOWrapper) -> set[str]:
    try:
        reader = csv.DictReader(fh, delimiter=";")
        vats = set()
        for row in reader:
            row_text = " ".join((v or "") for v in row.values())
            if not has_keyword(row_text):
                continue
            # Probeer alle kolommen die een ondernemingsnummer kunnen zijn
            for key in ("ondernemingsnummer", "enterprise_number", "ondernemingsnr",
                        "kbo_nr", "kbo nr", "vat", "btw", "entitynumber", "entity_number"):
                raw = (row.get(key) or "").strip()
                if raw:
                    vat = normalize_vat(raw)
                    if vat:
                        vats.add(vat)
                        break
        return vats
    except Exception as exc:
        print(f"[warn] CSV parse fout: {exc}", file=sys.stderr)
        return set()


def try_dates(days: int = 5) -> set[str]:
    today = dt.date.today()
    errors = []
    for delta in range(days):
        date_str = (today - dt.timedelta(days=delta)).strftime("%Y%m%d")
        try:
            raw = fetch_zip(date_str)
            all_vats: set[str] = set()
            for fh in find_csvs(raw):
                all_vats |= extract_vats(fh)
            if all_vats:
                print(f"[info] {len(all_vats)} VATs gevonden voor {date_str}", file=sys.stderr)
                return all_vats
            else:
                print(f"[info] Geen faillissementen gevonden voor {date_str}", file=sys.stderr)
        except Exception as exc:
            errors.append((date_str, str(exc)))
            print(f"[warn] {date_str}: {exc}", file=sys.stderr)
    raise RuntimeError(f"Geen KBO daily zip verwerkt in {days} dagen: {errors}")


def load_existing(path: str) -> set[str]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return {line.strip() for line in f if line.strip()}
    except FileNotFoundError:
        return set()


def main() -> int:
    try:
        new_vats = try_dates()
    except Exception as exc:
        print(f"[warn] KBO daily niet beschikbaar: {exc}", file=sys.stderr)
        print("[warn] vats.txt ongewijzigd gelaten.", file=sys.stderr)
        return 0  # Geen fout — bestaande vats.txt blijft intact

    existing = load_existing(OUT_PATH)
    merged = existing | new_vats
    added = new_vats - existing

    print(f"[info] Bestaand: {len(existing)}, Nieuw: {len(added)}, Totaal: {len(merged)}", file=sys.stderr)

    if not added and existing:
        print("[info] Geen nieuwe VATs — vats.txt ongewijzigd.", file=sys.stderr)
        return 0

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        for vat in sorted(merged):
            f.write(vat + "\n")
    print(f"[info] Geschreven: {len(merged)} VATs naar {OUT_PATH} ({len(added)} nieuw)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
