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

## Beer and spirits: corroborating the producer

The half of a lookup a model is most likely to invent is the **producer** -- a plausible brewery
in a plausible town. It is also the only part that can be checked against something outside the
model, so it is checked against two open sources, and neither is trusted to say yes on its own.

| | source | free | key | CORS |
| --- | --- | --- | --- | --- |
| Beer | Open Brewery DB **and** Wikidata | yes | none | direct from the PWA |
| Spirits | Wikidata | yes | none | direct from the PWA |
| Wine | none, deliberately | | | |

Wine is not an oversight: a wine's producer is checked implicitly by the palate model, which has
to place the bottle on a style scale before it can rank it at all.

**Spirits had nothing here until 2026-09-04**, and the reason was a false premise. This README
used to say "there is no open distillery database worth the wiring". Nobody had checked. Wikidata
types distilleries, breweries and drinks brands, and it carries a link.

### What it actually catches

Measured the way the first version was: real producers on one side, invented ones on the other,
scored here rather than trusted from the response.

    real distilleries   16/20      real breweries   6/8      invented   0/14

The misses are small or new craft producers -- Uncle Nearest, Westward, St. George Spirits, Clear
Creek. That is the right side to fail on, and **an unconfirmed producer is reported as
unconfirmed, never as fake**. Both outcomes appear on screen: printing nothing when unconfirmed
would make "checked and real" indistinguishable from "never looked".

### THE TRAP: a non-empty response is not a match

Open Brewery DB is a fuzzy search that almost always returns *something*. Asking it for
"Brasserie Cantillon" returns Brasserie Chouffe, Brasserie du Moulin and Brasserie de Bastogne,
with no Cantillon anywhere -- it matched the word "Brasserie". Treating that as corroboration
would take a hallucinated brewery and hand it back wearing a confirmation, which is worse than
not checking at all. So both sources are scored in `names.js` at a threshold measured against
invented names, and `brewery_type: "planning"` rows are excluded -- those are filings, not
breweries, and an invented "Saltmarsh Brewing" matched one in Foxboro during testing.

### Wikidata: what to know before touching it

- **Not SPARQL.** query.wikidata.org works and scores identically. It also takes about **eight
  seconds**, too slow even for a check that never blocks. CirrusSearch does the type filter
  server-side with `haswbstatement:` and answers in roughly a third of a second, then one batched
  `wbgetentities` fills in labels, aliases, website and the Wikipedia link.
- **Search on the name AS GIVEN**, and score the *stripped* tokens. Feeding the
  generic-stripped, punctuation-flattened string to a search engine lost Fuller's and Schneider
  Weisse. Those are two different jobs.
- **Score every label and alias in every language**, not the English label. Schneider Weisse is
  typed as a brewery and has no English label, so it came back as a bare Q-id and scored zero
  against its own name.
- **`business` and `enterprise` are not accepted types.** They would confirm any plausible company
  name, which is the whole failure this exists to prevent. Brands are accepted, because the
  question is "did the model invent this producer", and Four Roses being a known alcohol brand
  answers it.

## The score

Each wine gets a **palate match, 0-100**: where it falls in the spread of the 23 bottles you have
actually rated, computed in `palateMatch()` from the same fit that drives the order.

It is deliberately built out of ordering rather than prediction, because that is the half of the
model that works: pairwise accuracy is 72.7% overall and 92.3% on bottles at least 1.5 stars
apart, while leave-one-out R² on the rating itself is 0.33. So "you would give this a 4.2" is a
sentence this model has no right to say, and it is not said anywhere.

The score also fixes a real gap. `rel` is distance from *this list's* average, so the best bottle
on a terrible list and the best bottle on a great list look identical. The percentile is measured
against a fixed reference -- your own cellar -- so two bottles scanned on different nights are
comparable. Both are on screen: the coloured circle is `rel`, the number is the percentile.

**It is a percentile against a normal fitted to those 23, not against the 23 as a bag of items,
and that is not a detail.** The plain empirical percentile was the first version and the offline
dry-run killed it: a good wine list runs off the top of a 23-bottle cellar, so the top three
bottles all scored 100 and the bottom three all scored 0. Every statement was true and the number
had stopped discriminating exactly where it would be used. The fitted version never saturates and
is clamped to 1-99, because 0 and 100 are certainties this model does not have. Only his own
bottles set the scale -- nothing but their mean and spread goes in.

The literal count is a **different claim** and is shown separately, in the badge above the score
("ahead of 20 of the 23 you have rated"). Two numbers, two meanings, each said once.

`sip.py rank --dry-run` prints the same score, and the two implementations must stay in step:
JavaScript has no `erf`, so `palate.js` carries an Abramowitz & Stegun approximation while
`sip.py` uses `math.erf`. Cross-checking them is what caught the normal CDF being fed `z` instead
of `z / sqrt(2)` -- a bug that re-saturated the top of every list at 99 and looked perfectly
plausible on screen.

## Dryness, and why it is not ranked on

The style stack under a single bottle has four rows now. Three of them -- tannin, savoury,
aromatic lift -- are the axes `palate.json` was fitted on. **Dryness is described, not ranked
on**, and it is not in `axesUsed`.

It is *perceived* dryness rather than residual sugar, because ripe fruit and new-oak vanillin
read as sweetness in a wine with none: a jammy high-alcohol Grenache is not a 10. That framing is
what makes it vary across dry reds instead of flatlining at 9.

It is also the weakest number on the screen, and the app says so. The other three axes are
calibrated by six of his own scored bottles few-shotted into the prompt; the 23 anchors carry
`acid`, `body`, `tannin`, `oak`, `fruitRipeness`, `savory` and `aromaticLift` -- **no dryness** --
so it is anchored only on the style reference points written into the prompt. Score the 23 for
dryness and refit if you ever want it in the model.

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
  R² 0.33) but ranks well (92% correct on bottles far apart). The 0-100 palate match is a
  percentile built out of that ordering; nothing in the UI shows a predicted star score.
- **Dryness is uncalibrated.** It is the one axis with no anchor among the 23, so it rests on
  the prompt's reference points alone. Shown, never ranked on.
- **Reds only.** All 23 training bottles are red. Whites, rosé and sparkling are guesses. A
  single bottle says so on screen, because there the caveat is the whole answer rather than
  a footnote under a list.
- **A bottle is identified twice over.** Which bottle it is, then what style it is. The
  placement is only as good as the weaker of the two, so the confidence floor is applied to
  `min(identification, scoring)` and below it nothing is placed at all.
- **Wine only.** Beer and whiskey parse but have no palate model. Reported, not ranked. Both do
  get their producer corroborated and linked; see above.
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

    src/lib/names.js       producer-name matching, shared by both corroboration sources
    src/lib/producer.js    asks both sources, merges the answers, writes the source tag
    src/lib/wikidata.js    breweries AND distilleries, with a link  (no key, direct)
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
