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

## Beer and spirits: the one available check

Both tabs take a typed name or a photograph of the label. The photo is the better of the
two when the can is in your hand, because the model is reading rather than recalling.

Neither is checked by the model itself, and the half a model is likeliest to invent is the
producer: a plausible brewery in a plausible town. So for beer the producer is corroborated
against **Open Brewery DB** — free, no key, and it reflects the caller's origin in its CORS
headers, so the PWA calls it directly with no proxy and no new credential.

**The trap: a non-empty response is not a match.** It is a fuzzy search that almost always
returns something. Ask it for "Brasserie Cantillon" and it returns Brasserie Chouffe,
Brasserie du Moulin and Brasserie de Bastogne, with no Cantillon anywhere, because it
matched on the word "Brasserie". Treating that as corroboration would hand a hallucinated
brewery back wearing a confirmation, which is worse than never checking.

So `lib/brewery.js` strips the generic words, searches on what is left, and scores the
results itself. Measured over 17 real breweries and 8 invented ones, a 0.75 token-overlap
threshold confirms 13 of the real and **none** of the invented. Rows with
`brewery_type: "planning"` are excluded — those are filings, not breweries, and a made-up
"Saltmarsh Brewing" matched one during testing.

Four real breweries miss (Cloudwater, Birrificio Italiano, Fuller's, Schneider Weisse), and
that is the right side to fail on. **A miss is reported as unconfirmed, never as wrong.**
Both outcomes appear on screen, because showing nothing when unconfirmed makes "checked and
real" indistinguishable from "never looked", which is the entire value of checking.

Spirits get none of this. There is no open distillery database worth wiring, and the screen
must not imply otherwise.

## Saved lists, and who can see them

Every drink you keep is one row in `sip_tastings`. A row with **no rating** is on your *To try*
list; rating it is what moves it to *Tried*, which is ordered by your own score, best first.
There is no status column -- a second field that could disagree with the rating is a bug waiting
to happen -- and no way to be on both lists or neither.

That ranking is **yours, not the model's**. palate-v1 ranks bottles you have *not* tried; Tried
ranks the ones you have, using the scores you gave them. The two must not be read as the same
number.

**Wine is shared across the household. Beer and spirits are not.** Nate and Amanda keep one wine
list with one rating per bottle, either of them can set or change it, and neither sees the
other's whisky. The split is enforced in the RLS policy, not in the client, so the app queries
all three categories identically and the database decides what comes back. Membership comes from
`household_members(owner_id, member_email)`, which Stock already built and keys by email so a
member can be added before they have ever signed in.

    supabase/migrations/20260902_sip_shared_wine_and_lists.sql

This repo is **not linked** to the suite project and that file is **not applied automatically**.
Run it by hand before deploying anything that claims wine is shared, or the app will say so while
the policy still says otherwise.

## Setup

    cp ../reading-app/.env .env      # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
    npm install
    npm run dev

`vite.config.js` refuses to build without the Supabase env. Without that guard the app code is
dead-code-eliminated, the build "succeeds", and the deployed page is blank white. The only tell
is bundle size.

## The offline harness

Two of them, for two different jobs.

`VITE_HARNESS=1 npm run dev` swaps the auth client and the tastings store for in-memory fakes in
`harness/`. Everything in Sip sits behind an email one-time code, so without this the saved lists
cannot be looked at during development without a code from a live inbox -- and To try / Tried is a
screen you have to see to judge. It is refused outright in a production build. It does **not**
fake the model proxy, which still wants a real token, so lookups fail under it by design.

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
- **Wine only.** Beer and whiskey parse but have no palate model. Reported, not ranked. Beer
  does get its brewery corroborated; see below.
- **Low-confidence wines are held back**, not ranked. "House Red" cannot be scored and guessing
  would be worse than abstaining.
- **No wine database.** Axis scores are inferred from the name. Vivino has no API, Wine-Searcher
  is paid, and the model already knows regional style.
- **The anchors are load-bearing.** `src/data/anchors.json` calibrates the scorer against six of
  your own scored bottles. Change them and the axis scale drifts; refit `palate.json` if you do.
- **Untested against a real menu photo.** The ranking math, the build and the saved lists are
  verified. The model calls have never run against real input.
- **The `source` tag has been lying since the brewery confirmer shipped.** A CHECK constraint on
  the column allowed only `lookup` / `menu` / `import`, so every `label` and `+obdb` write was
  rejected and fell back to `lookup` through the retry in `addTasting`. Ratings were never lost;
  provenance always was. The migration widens the constraint -- drop the retry once it is
  applied.

## Files

    src/lib/proxy.js       shared edge-function client, image downscale, JSON extraction
    src/lib/menu.js        list photo -> entries     (gemini-2.5-flash)
    src/lib/bottle.js      label photo -> one wine   (gemini-2.5-flash)
                           typed name  -> one wine   (claude-haiku-4-5)
    src/lib/lookup.js      beer/spirit name or label -> drink + style axes
                                                     (claude-haiku-4-5 / gemini-2.5-flash)
    src/lib/brewery.js     brewery -> corroborated?  (Open Brewery DB, no key)
    src/lib/score.js       wines -> style axes       (claude-sonnet-4-6, anchored)
    src/lib/palate.js      axes -> ranking, and one bottle -> a place in your cellar
                                                     (local, deterministic)
    src/data/palate.json   fitted model, coefficients, validation
    src/data/anchors.json  your 23 bottles scored on 7 style axes
    data/winecom-mywine.json   54 captured items, 23 rated
    sip.py                offline harness for the ranking math
