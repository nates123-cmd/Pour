# Pour

Photograph a drinks list, get it ranked against your own palate.

A suite PWA. Built from 23 wine.com ratings, all reds.

## Architecture

    photo ──> gemini-2.5-flash ──> entries ──> claude-sonnet-4-6 ──> axes ──> JS ──> ranking
              (via suite proxy)               (via suite proxy)            (local)

Two rules shaped this:

**The ranking math is local.** `src/lib/palate.js` applies the palate-v1 coefficients in plain
JS. The model only supplies style estimates. When a recommendation looks wrong you can tell
whether the axis estimate was bad or the coefficients were, instead of shrugging at a black box.
Verified to produce the identical order as `pour.py` on the same fixture.

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

## Setup

    cp ../reading-app/.env .env      # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
    npm install
    npm run dev

`vite.config.js` refuses to build without the Supabase env. Without that guard the app code is
dead-code-eliminated, the build "succeeds", and the deployed page is blank white. The only tell
is bundle size.

## The offline harness

`pour.py` is the CLI the ranking math was proven in. It is not the product, but it stays because
it exercises the ranking end to end with no auth and no network:

    ./.venv/bin/python pour.py rank --dry-run fixtures/sample_menu.json --verbose

## Honest limits

- **It ranks, it does not rate.** palate-v1 predicts your exact score poorly (leave-one-out
  R² 0.33) but ranks well (92% correct on bottles far apart). Nothing in the UI shows a
  predicted star score.
- **Reds only.** All 23 training bottles are red. Whites, rosé and sparkling are guesses.
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
    src/lib/menu.js        photo -> entries          (gemini-2.5-flash)
    src/lib/score.js       wines -> style axes       (claude-sonnet-4-6, anchored)
    src/lib/palate.js      axes -> ranking           (local, deterministic)
    src/data/palate.json   fitted model, coefficients, validation
    src/data/anchors.json  your 23 bottles scored on 7 style axes
    data/winecom-mywine.json   54 captured items, 23 rated
    pour.py                offline harness for the ranking math
