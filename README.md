# Sip

Photograph a drinks list, get it ranked against your own palate. Or photograph
one bottle, or type its name, and find out where it sits.

A suite PWA. Built from 23 wine.com ratings, all reds.

## Architecture

Three ways in, one scorer and one ranking model behind all of them:

    list photo ──> gemini-2.5-flash ─┐
    label photo ─> gemini-2.5-flash ─┼─> wine ──> claude-sonnet-4-6 ──> axes ──> JS
    typed name ──> claude-haiku-4-5 ─┘            (via suite proxy)         (local)

A list is ranked against itself. A single bottle has no list, so it is placed
against the 23 bottles the model was fitted on — see "One bottle" below.

Two rules shaped this:

**The ranking math is local.** `src/lib/palate.js` applies the palate-v1 coefficients in plain
JS. The model only supplies style estimates. When a recommendation looks wrong you can tell
whether the axis estimate was bad or the coefficients were, instead of shrugging at a black box.
Verified to produce the identical order as `sip.py` on the same fixture.

**One scorer, one scale.** Both single-bottle paths hand their wine to the same anchored
`scoreWines` the list uses. A second scoring prompt would be a second scale, and the
palate-v1 coefficients only mean anything on the scale the anchors establish. Identification
is the only thing the bottle paths do differently.

**Cheap model where errors are visible, capable model where they are not.** A garbled wine name
is obvious on screen and you can correct it, so reading the photo runs on Gemini Flash. A wrong
axis estimate produces a confident, plausible-looking order with nothing on screen to flag it,
so scoring does not get the cheap model. Cost is not the constraint: this is one scan per
restaurant visit.

Both calls go through the suite's shared `claude` edge function, which is a multi-model relay
keyed on the `model` string. No new credential.

### Landmine: never use `supabase.functions.invoke` here

It attaches an `x-client-info` header, the function's CORS policy allows only
`authorization, content-type, apikey`, so the preflight fails and the request never leaves the
device. supabase-js reports it as "Failed to send request to Edge Function", which reads like
the function is down when nothing was called at all. `src/lib/proxy.js` sends the request itself
with only the three allowed headers. Same workaround as `reading-app/src/lib/vision.js`.

### The proxy relays text, not structured outputs

There is no schema guarantee the way there is calling the API directly, so both calls use
prompt-instructed JSON plus tolerant extraction with a brace-scan fallback. A long wine list is
a much bigger payload than the suite's other calls, so truncation is a real failure mode and is
reported as truncation ("photograph it in two halves"), not as an unreadable photo.

## One bottle

`rel` — the number that colours every circle in this app — is a wine's distance from its
list's average. A list of one averages to itself, so `rel` is 0 by construction and the
circle would always be the same colour. Predicting a score instead is exactly what
palate-v1 cannot do.

So `placeInCellar` swaps the baseline rather than the quantity. The 23 fitted bottles are a
real, fixed reference set; measuring against their average gives the same units, the same
six colours, and a claim worth reading — **a rank among bottles you have actually rated**.
Ranking is what palate-v1 is good at.

Checked by putting all 23 back through it: every colour band is reachable, the placement
agrees with the real ratings on 77% of pairs, and the bottles rated 4.5 land at 20–22 of 23
while the one rated 2.0 lands at 0. The cellar spread (−0.77..+0.76) is close enough to a
typical list's that the colour thresholds need no second set of numbers.

`near` returns names only, deliberately. Each anchor also carries `myRating`, and printing
the nearest bottle's real score beside a new bottle would read as a prediction for the new
bottle. The names alone are enough — you remember what you thought of them.

## Setup

    cp ../reading-app/.env .env      # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
    npm install
    npm run dev

`vite.config.js` refuses to build without the Supabase env. Without that guard the app code is
dead-code-eliminated, the build "succeeds", and the deployed page is blank white. The only tell
is bundle size.

## The offline harness

`sip.py` is the CLI the ranking math was proven in. It is not the product, but it stays because
it exercises the ranking end to end with no auth and no network:

    ./.venv/bin/python sip.py rank --dry-run fixtures/sample_menu.json --verbose

## Honest limits

- **It ranks, it does not rate.** palate-v1 predicts your exact score poorly (leave-one-out
  R² 0.33) but ranks well (92% correct on bottles far apart). Nothing in the UI shows a
  predicted star score.
- **Reds only.** All 23 training bottles are red. Whites, rosé and sparkling are guesses. A
  single bottle says so on screen, because there the caveat is the whole answer rather than
  a footnote under a list.
- **A bottle is identified twice over.** Which bottle it is, then what style it is. The
  placement is only as good as the weaker of the two, so the confidence floor is applied to
  `min(identification, scoring)` and below it nothing is placed at all.
- **Wine only.** Beer and whiskey parse but have no palate model. Reported, not ranked.
- **Low-confidence wines are held back**, not ranked. "House Red" cannot be scored and guessing
  would be worse than abstaining.
- **No wine database.** Axis scores are inferred from the name. Vivino has no API, Wine-Searcher
  is paid, and the model already knows regional style.
- **The anchors are load-bearing.** `src/data/anchors.json` calibrates the scorer against six of
  your own scored bottles. Change them and the axis scale drifts; refit `palate.json` if you do.
- **Untested against a real menu photo.** The ranking math and the build are verified. The two
  model calls have never run.

## Files

    src/lib/proxy.js       shared edge-function client, image downscale, JSON extraction
    src/lib/menu.js        list photo -> entries     (gemini-2.5-flash)
    src/lib/bottle.js      label photo -> one wine   (gemini-2.5-flash)
                           typed name  -> one wine   (claude-haiku-4-5)
    src/lib/score.js       wines -> style axes       (claude-sonnet-4-6, anchored)
    src/lib/palate.js      axes -> ranking, and one bottle -> a place in your cellar
                                                     (local, deterministic)
    src/data/palate.json   fitted model, coefficients, validation
    src/data/anchors.json  your 23 bottles scored on 7 style axes
    data/winecom-mywine.json   54 captured items, 23 rated
    sip.py                offline harness for the ranking math
