#!/usr/bin/env python3
"""
Sip - photograph a drinks list, get it ranked against your own palate.

Pipeline:
  1. prep image (HEIC -> JPEG, downscale)          local, sips
  2. parse menu photo -> structured entries         Claude (vision)
  3. score each wine on style axes                  Claude (calibrated on your own bottles)
  4. rank with palate-v1 coefficients               local, deterministic

Step 4 is deliberately NOT done by the model: the ranking math stays auditable
and reproducible. The model only supplies style estimates.

Usage:
  sip.py rank menu.jpg [--top N] [--max-price 80] [--json] [--verbose]
  sip.py rank --dry-run fixtures/sample_menu.json     # no API key needed
"""

import argparse, base64, json, math, os, subprocess, sys, tempfile
from pathlib import Path
from typing import List, Optional, Literal

from pydantic import BaseModel, Field

MODEL = "claude-opus-5"
ROOT = Path(__file__).resolve().parent
PALATE_PATH = ROOT / "data" / "palate-v1.json"
ANCHORS_PATH = ROOT / "data" / "axes-wine-v1.json"
MAX_EDGE = 1568  # Claude's recommended max long edge


# ---------------------------------------------------------------- schemas

class MenuEntry(BaseModel):
    raw: str = Field(description="the line exactly as printed, verbatim")
    kind: Literal["wine", "beer", "whiskey", "other"]
    producer: Optional[str] = None
    wine: Optional[str] = Field(default=None, description="cuvee or bottling name")
    appellation: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    varietal: Optional[str] = None
    vintage: Optional[int] = None
    price_glass: Optional[float] = None
    price_bottle: Optional[float] = None
    section: Optional[str] = Field(default=None, description="menu heading it sat under")


class ParsedMenu(BaseModel):
    entries: List[MenuEntry]
    unreadable_lines: List[str] = Field(
        default_factory=list,
        description="lines that are clearly drink entries but could not be read confidently",
    )


class AxisScore(BaseModel):
    raw: str = Field(description="the raw line this scores, copied verbatim from the input")
    tannin: int = Field(ge=1, le=10)
    savory: int = Field(ge=1, le=10)
    aromatic_lift: int = Field(ge=1, le=10)
    confidence: float = Field(ge=0.0, le=1.0,
                              description="how confident you are you know this wine's actual style")
    basis: str = Field(description="one short clause: what you keyed on")


class ScoredMenu(BaseModel):
    scores: List[AxisScore]


# ---------------------------------------------------------------- image prep

def prep_image(path: Path) -> tuple[bytes, str]:
    """Convert HEIC->JPEG and downscale. Returns (bytes, media_type)."""
    suffix = path.suffix.lower()
    tmpdir = Path(tempfile.mkdtemp(prefix="sip_"))
    work = tmpdir / "menu.jpg"

    if suffix in (".heic", ".heif", ".png", ".tif", ".tiff", ".webp"):
        subprocess.run(["sips", "-s", "format", "jpeg", str(path), "--out", str(work)],
                       check=True, capture_output=True)
    else:
        work.write_bytes(path.read_bytes())

    subprocess.run(["sips", "-Z", str(MAX_EDGE), str(work)], check=True, capture_output=True)
    data = work.read_bytes()
    if len(data) > 4_500_000:
        subprocess.run(["sips", "-s", "formatOptions", "60", str(work)],
                       check=True, capture_output=True)
        data = work.read_bytes()
    return data, "image/jpeg"


# ---------------------------------------------------------------- calibration

def anchor_block() -> str:
    """Few-shot anchors drawn from the user's own scored bottles, spanning the range.

    This is what keeps menu wines on the same axis scale the model was fit on.
    Without it the axis numbers drift and the ranking is meaningless.
    """
    a = json.loads(ANCHORS_PATH.read_text())
    picks = ["Nicosia Frappato di Vittoria Sabbie di Sutta 2024",
             "Tornatore Etna Rosso 2022",
             "Patrizi Barbaresco 2022",
             "Chateau Mourgues du Gres Costieres de Nimes Galets Rouge 2023",
             "Pikes Eastside Shiraz 2022",
             "Los Vascos Cromas Gran Reserva Carmenere 2020"]
    lines = []
    for w in a["wines"]:
        if w["name"] in picks:
            lines.append(f'  {w["name"]}: tannin {w["tannin"]}, savory {w["savory"]}, '
                         f'aromatic_lift {w["aromaticLift"]}')
    return "\n".join(lines)


SCORE_SYSTEM = """You score wines on three style axes. You are calibrating estimates that feed a \
numeric ranking model, so consistency with the anchor examples matters more than nuance.

Axes, each 1-10:
  tannin        - astringency and grip. 1 = Frappato/Gamay, 5 = Grenache blend, 10 = young Barolo.
  savory        - earth, herb, olive, iron, smoke, funk, as opposed to pure fruit sweetness.
                  1 = fruit-bomb New World red, 10 = Etna Rosso or old-school Bandol.
  aromatic_lift - floral, perfumed, high-toned aromatics. 1 = heavy oaked Cabernet,
                  10 = Frappato, Cru Beaujolais, Nerello Mascalese.

Score the wine's STYLE, not its quality. A great heavy oaky wine still scores low aromatic_lift.

Use the producer, appellation, varietal and vintage to infer style. If you do not recognise the \
producer, infer from appellation and varietal alone and lower your confidence. Set confidence \
below 0.4 when you are essentially guessing. Do not silently guess at high confidence.

Anchor examples, already scored on this exact scale:
{anchors}

Return one entry per wine given, copying the `raw` string back verbatim so results can be joined."""


PARSE_SYSTEM = """You read photographs of drinks lists and extract every entry.

Rules:
- Transcribe `raw` exactly as printed, including abbreviations. Do not tidy it.
- Split producer from cuvee where the convention is clear; leave fields null when unsure.
- Never invent a vintage, region or price that is not on the page. Null is correct.
- Prices: put by-the-glass in price_glass and bottle in price_bottle. A list with a single \
price column is usually bottle for a wine list and glass for a beer or cocktail list; use the \
section heading to decide.
- Capture the section heading each entry sits under.
- If a line is clearly a drink but genuinely illegible, put it in unreadable_lines rather than \
guessing at its contents."""


# ---------------------------------------------------------------- model calls

def call_parse(client, img: bytes, media_type: str) -> ParsedMenu:
    r = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=PARSE_SYSTEM,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": media_type,
                    "data": base64.standard_b64encode(img).decode()}},
                {"type": "text", "text": "Extract every drink entry from this list."},
            ],
        }],
        output_format=ParsedMenu,
    )
    return r.parsed_output


def call_score(client, wines: List[MenuEntry]) -> ScoredMenu:
    listing = "\n".join(
        f"- raw: {w.raw}\n  producer: {w.producer}  wine: {w.wine}  varietal: {w.varietal}"
        f"  appellation: {w.appellation}  region: {w.region}  vintage: {w.vintage}"
        for w in wines)
    r = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=SCORE_SYSTEM.format(anchors=anchor_block()),
        messages=[{"role": "user", "content": f"Score these {len(wines)} wines:\n\n{listing}"}],
        output_format=ScoredMenu,
    )
    return r.parsed_output


# ---------------------------------------------------------------- ranking (local)

def load_palate():
    p = json.loads(PALATE_PATH.read_text())
    m = p["model"]
    return m["axesUsed"], m["coefStandardized"], m["axisMean"], m["axisSd"], m["intercept"]


AXIS_KEY = {"tannin": "tannin", "savory": "savory", "aromaticLift": "aromatic_lift"}


def palate_score(axes, coef, mu, sd, intercept, s: AxisScore) -> float:
    total = intercept
    for a in axes:
        v = getattr(s, AXIS_KEY[a])
        total += coef[a] * (v - mu[a]) / sd[a]
    return total


def cellar_fits():
    """Fit index for each of the 23 anchor bottles, the reference the score is a
    percentile against. Same set and same maths as CELLAR in src/lib/palate.js."""
    axes, coef, mu, sd, intercept = load_palate()
    fits = []
    for w in json.loads(ANCHORS_PATH.read_text())["wines"]:
        total = intercept
        for a in axes:
            total += coef[a] * (w[a] - mu[a]) / sd[a]
        fits.append(total)
    return fits


def palate_match(fit: float, fits) -> int:
    """The 0-100 palate match: where this bottle falls in the spread of the 23
    bottles he has actually rated. Built out of ordering, not prediction.

    Taken against a normal fitted to those 23 rather than against the 23 as a
    bag of items: a good list runs off the top of a 23-bottle cellar, and the
    plain empirical percentile gave three 100s and three 0s on the sample menu
    -- true, and useless for choosing between the good ones. Clamped to 1..99
    because 0 and 100 are certainties this model does not have.

    Must stay identical to palateMatch() in src/lib/palate.js."""
    mean = sum(fits) / len(fits)
    sd = (sum((f - mean) ** 2 for f in fits) / (len(fits) - 1)) ** 0.5
    pct = 100 * 0.5 * (1 + math.erf((fit - mean) / (sd * math.sqrt(2))))
    return min(99, max(1, round(pct)))


def rank(entries: List[MenuEntry], scores: List[AxisScore]):
    axes, coef, mu, sd, intercept = load_palate()
    fits = cellar_fits()
    by_raw = {s.raw: s for s in scores}
    out = []
    for e in entries:
        s = by_raw.get(e.raw)
        if s is None:
            continue
        fit = palate_score(axes, coef, mu, sd, intercept, s)
        out.append({
            "entry": e, "axes": s, "fit": fit,
            "match": palate_match(fit, fits),
        })
    out.sort(key=lambda r: (-r["fit"]))
    return out


# ---------------------------------------------------------------- output

def price_of(e: MenuEntry):
    return e.price_bottle if e.price_bottle is not None else e.price_glass


def render(ranked, top, max_price, verbose):
    shown = [r for r in ranked
             if max_price is None or (price_of(r["entry"]) or 0) <= max_price]
    if not shown:
        print("No wines under that price.")
        return

    confident = [r for r in shown if r["axes"].confidence >= 0.4]
    unsure = [r for r in shown if r["axes"].confidence < 0.4]

    # Relative only. The raw fit is intercept-plus-deviations on the 1-5 star
    # scale, and palate-v1 is not accurate enough to show as a predicted score
    # (LOO R^2 0.33). It ranks well, so report distance from this list's mean.
    if confident:
        base = sum(r["fit"] for r in confident) / len(confident)
        for r in confident:
            r["rel"] = r["fit"] - base

    print()
    if confident:
        pick = confident[0]
        e = pick["entry"]
        pr = price_of(e)
        print(f"  TOP PICK   {e.raw}")
        print(f"             {pick['axes'].basis}" + (f"   ${pr:.0f}" if pr else ""))
        print()

    print(f"  Ranked ({len(confident)} scored with confidence)"
          f"   [match = 0-100 against the spread of your 23 rated bottles]:")
    for i, r in enumerate(confident[:top], 1):
        e, a = r["entry"], r["axes"]
        pr = price_of(e)
        tag = f" ${pr:.0f}" if pr else ""
        print(f"   {i:2d}. {r['match']:3d}  {e.raw[:57]:57s}{tag}")
        if verbose:
            print(f"       tannin {a.tannin}  savory {a.savory}  lift {a.aromatic_lift}"
                  f"   match {r['match']:3d}"
                  f"   {r['rel']:+.2f} vs list avg   conf {a.confidence:.2f}")
            print(f"       {a.basis}")

    if unsure:
        print(f"\n  Low confidence, not ranked ({len(unsure)}): "
              f"{', '.join(r['entry'].raw[:34] for r in unsure[:6])}")


def load_env():
    """Read ROOT/.env if present so the key never has to live in the shell history."""
    f = ROOT / ".env"
    if not f.exists():
        return
    for line in f.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main():
    load_env()
    ap = argparse.ArgumentParser(prog="sip")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("rank", help="rank a drinks list photo against your palate")
    r.add_argument("image", nargs="?")
    r.add_argument("--dry-run", metavar="FIXTURE",
                   help="skip the API, use a saved parse+score fixture")
    r.add_argument("--top", type=int, default=10)
    r.add_argument("--max-price", type=float, default=None)
    r.add_argument("--json", action="store_true")
    r.add_argument("--verbose", "-v", action="store_true")
    a = ap.parse_args()

    if a.dry_run:
        fx = json.loads(Path(a.dry_run).read_text())
        entries = [MenuEntry(**e) for e in fx["entries"]]
        scores = [AxisScore(**s) for s in fx["scores"]]
    else:
        if not a.image:
            ap.error("give an image path, or --dry-run FIXTURE")
        try:
            import anthropic
        except ImportError:
            sys.exit("pip install anthropic")
        if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
            sys.exit("No credentials. export ANTHROPIC_API_KEY=... (see README)")
        client = anthropic.Anthropic()

        img, mt = prep_image(Path(a.image))
        parsed = call_parse(client, img, mt)
        entries = parsed.entries
        if parsed.unreadable_lines:
            print(f"  [{len(parsed.unreadable_lines)} lines unreadable, skipped]", file=sys.stderr)

        wines = [e for e in entries if e.kind == "wine"]
        others = [e for e in entries if e.kind != "wine"]
        if others:
            print(f"  [{len(others)} non-wine entries found; no palate model for those yet]",
                  file=sys.stderr)
        if not wines:
            sys.exit("No wines found on that list.")
        scores = call_score(client, wines).scores
        entries = wines

    ranked = rank(entries, scores)
    missing = len(entries) - len(ranked)
    if missing:
        print(f"  [{missing} entries dropped: scorer did not return a matching row]",
              file=sys.stderr)

    if a.json:
        print(json.dumps([{
            "rank": i + 1, "raw": r["entry"].raw,
            "fitIndex": round(r["fit"], 3),
            "_fitIndexNote": "relative ranking index only, NOT a predicted star rating",
            "confidence": r["axes"].confidence,
            "axes": {"tannin": r["axes"].tannin, "savory": r["axes"].savory,
                     "aromaticLift": r["axes"].aromatic_lift},
            "basis": r["axes"].basis,
            "price": price_of(r["entry"]),
        } for i, r in enumerate(ranked)], indent=1))
    else:
        render(ranked, a.top, a.max_price, a.verbose)


if __name__ == "__main__":
    main()
