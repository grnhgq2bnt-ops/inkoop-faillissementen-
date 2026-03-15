#!/usr/bin/env python3
import argparse, json, sys, time, urllib.parse, urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

def read_vats(vat_file, vat_inline):
    vats = []
    if vat_file:
        text = vat_file.read_text(encoding="utf-8")
        for token in text.replace(",", "\n").replace(";", "\n").split():
            vats.append(token.strip())
    for v in vat_inline:
        vats.append(v.strip())
    out = [v.replace(" ", "") for v in vats if v]
    seen, uniq = set(), []
    for v in out:
        if v not in seen:
            seen.add(v); uniq.append(v)
    return uniq

def fetch_vat(vat, apikey, accountid, lang, est, fin, timeout=10.0):
    params = {"vat": vat, "lang": lang, "est": est, "fin": fin, "apikey": apikey, "accountid": accountid}
    url = "https://www.staatsbladmonitor.be/sbmapi.json?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def iter_strings(obj):
    if isinstance(obj, str): yield obj
    elif isinstance(obj, dict):
        for v in obj.values(): yield from iter_strings(v)
    elif isinstance(obj, list):
        for v in obj: yield from iter_strings(v)

def find_first(obj, keys):
    if isinstance(obj, dict):
        for k in keys:
            if k in obj: return obj[k]
        for v in obj.values():
            found = find_first(v, keys)
            if found is not None: return found
    if isinstance(obj, list):
        for v in obj:
            found = find_first(v, keys)
            if found is not None: return found
    return None

def extract_address(obj):
    muni = find_first(obj, ("municipality","gemeente","locality","city"))
    postal = find_first(obj, ("postal_code","postcode","zip","postalcode"))
    return (str(muni) if muni else "", str(postal) if postal else "")

def extract_date(obj):
    cand = find_first(obj, ("publicationDate","decisionDate","date","openingDate","datum"))
    if cand:
        s = str(cand)[:10]
        if len(s)==10 and s[2]=="/" and s[5]=="/":
            dd,mm,yyyy = s.split("/"); return f"{yyyy}-{mm}-{dd}"
        return s
    return ""

def is_bankruptcy(obj):
    for s in iter_strings(obj):
        if any(kw in s.lower() for kw in ("faill","bankrupt","faillite")): return True
    return False

def normalize_record(payload, vat, source_ref):
    if not is_bankruptcy(payload): return None
    name = find_first(payload, ("denomination","name","naam","benaming","companyname"))
    date = extract_date(payload)
    muni, postal = extract_address(payload)
    return {"id": f"{date or 'unknown'}-{vat}", "date": date, "municipality": muni, "province": "",
            "company_name": name or vat, "enterprise_number": vat, "street": "", "postal_code": postal,
            "court": "", "source_ref": source_ref, "source_url": ""}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vat-file", type=Path)
    ap.add_argument("--vat", action="append", default=[])
    ap.add_argument("--apikey", required=True)
    ap.add_argument("--accountid", required=True)
    ap.add_argument("--lang", default="nl")
    ap.add_argument("--est", default="0")
    ap.add_argument("--fin", default="1")
    ap.add_argument("--sleep", type=float, default=0.6)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    vats = read_vats(args.vat_file, args.vat)
    if not vats:
        print("Geen VAT-nummers opgegeven.", file=sys.stderr); return 1
    out, seen_ids = [], set()
    for i, vat in enumerate(vats, start=1):
        try:
            payload = fetch_vat(vat, args.apikey, args.accountid, args.lang, args.est, args.fin)
            rec = normalize_record(payload, vat, f"Staatsbladmonitor {vat}")
            if rec and rec["id"] not in seen_ids:
                seen_ids.add(rec["id"]); out.append(rec)
        except Exception as e:
            print(f"[{i}/{len(vats)}] {vat}: fout {e}", file=sys.stderr)
        time.sleep(args.sleep)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2); f.write("\n")
    print(f"Geschreven: {len(out)} records → {args.output}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
