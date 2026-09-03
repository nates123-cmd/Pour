# Sip — design constraints

Read this before changing anything visual. It exists so the app keeps a point of
view instead of drifting back to the generic default that any code generator
produces when left unconstrained.

## Reference

**_Wine Simple_, Aldo Sohm (Clarkson Potter, 2019).** Bright, flat, friendly
graphic design that deliberately rejects wine-snob visual language. Warm cream
paper, near-black ink, big flat circles of wine colour, square corners, hairline
rules, tiny letterspaced caps labels.

The thing to keep hold of: the book is *approachable*. It is not dark, not
moody, not elegant, not a leather-bound cellar book. If a change makes Sip feel
more serious, it is wrong.

## Banned

These are the defaults that made the app look machine-made. Do not reintroduce
them.

- **Dark moody wine palette.** Claret on near-black is the cliché this app spent
  a version in and climbed out of.
- **Border radius on anything except the one outline pill badge.** Square
  corners are load-bearing here.
- **Box shadows. Gradients.** Both. Anywhere. Flat colour only.
- **Inter, Roboto, Space Grotesk, Poppins, or a bare system font stack** as the
  display face.
- **Bordered rounded cards** as the way to group things. Group with space and
  hairline rules.
- **Icons beside text labels.** A glyph earns its place by carrying meaning on
  its own (the axis circle, the arrow, the asterisk) or it does not appear.
- **Star characters** for ratings. Circles, per the book.

## Colour

Ground and ink:

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#faf5ea` | Page ground. Warm cream. |
| `--paper-2` | `#f2ead7` | Bands and fills that sit on the ground. |
| `--ink` | `#191512` | Text and rules. Warm near-black. |
| `--ink-60` | `#6b6157` | Supporting prose. |
| `--ink-35` | `#a2988a` | Rank numbers, prices, counts. |
| `--rule` | `#191512` at 14% | Hairlines. |

The palate scale. Six flat circle colours lifted from the book's cover cluster,
ordered along Sip's single axis — **fresh, savoury, high-toned** at the violet
end, **ripe, oaky, heavy** at the amber end:

| Token | Value | Position |
| --- | --- | --- |
| `--s1` | `#7b3f9d` | Most your palate |
| `--s2` | `#6e2a46` | |
| `--s3` | `#c4506a` | |
| `--s4` | `#a8443a` | |
| `--s5` | `#d2724a` | |
| `--s6` | `#e0a838` | Least your palate |

`--s2` doubles as the action colour — the shutter button, the lookup button, the
active tab dot — which is coherent rather than a clash: the action colour is the
colour of the end of the scale you actually want. No colour outside this table
enters the app.

**The circles are not decoration.** Each ranked wine gets one, coloured by
`rel` — its distance from an average, which is the only fit number the model is
honest enough to show. For a list that average is the list; for a single bottle
it is your own 23 rated bottles. That is the book's grape-cluster motif doing
actual work. Never colour a circle by anything else.

**Watch the specificity when you size a circle.** `.pick .bigdot` and `.dot.s1`
have equal specificity, so a `background` on the sizing rule wins on source
order and silently paints every big circle `--s2` whatever `step()` decided.
That shipped once: the largest circle on the screen was pure decoration and the
scale legend directly above it was teaching a colour the circle never used. Size
in `.bigdot`, colour in `.dot.sN`, never both.

## Type

Three faces, three jobs. A face used outside its job is a bug.

| Face | Job |
| --- | --- |
| **Jost** | Display only. Page title, section heads, big numbers. Geometric, Futura-adjacent, set tight and large. |
| **Hanken Grotesk** | Everything read at size: wine names, body, labels, controls. |
| **Instrument Serif Italic** | The characterizing phrase and nothing else — the tasting note under a wine, matching the book's "Full-Bodied Finesse" line. |

Scale: `11 / 13 / 15 / 17 / 22 / 40`. Labels are 11px caps at `.2em` tracking.
Keep the jump from label to display violent; that contrast is the whole look.

## Devices

Port these from the book, and prefer them over inventing new ones.

- **Hairline rules** full-bleed under running heads and between list rows.
- **Tiny letterspaced caps** for every label, often centred.
- **Centred stacked lists** separated by hairlines, for anything enumerable.
- **`✳` asterisk bullets** for caveats and essentials.
- **`→` arrow prefix** for a recommendation or a pointer.
- **Outline pill badge**, hairline stroke, no fill — the one rounded thing.
- **Flat colour circles** at any size, never with a stroke or a shadow.
- **Caps-label mode strip** over a hairline, active mode underlined in `--s2`.
  This is the label device doing navigation. It is not a segmented control: no
  pill group, no fill, no rounding, no icons.

Anything enumerable gets the hairline-separated stack, including the three style
axes on a single bottle — label left, figure right in the display face. Three
numbers side by side is a stat row, and a stat row is a dashboard, which is the
look this app already climbed out of once.

## Looking at it

Design changes here were made blind once and it showed. Before committing a
visual change, render it and look at it.

The app needs auth and a live model call to reach a ranked list, so the quickest
route is a scratch `preview.html` at the repo root that pulls in
`/src/styles.css` and hard-codes the real class names against sample wines, then
`npx vite` and open it. Delete it afterwards rather than committing it — a
second copy of the markup drifts out of sync and then misleads.

## Honesty rules that outrank the design

These come from the model, not from taste, and the design must not fight them.

- **Never show a predicted star score for a wine.** `fitIndex` looks like a
  rating and is not one. Show `rel` as a circle, and the palate match as the
  number.
- **The palate match score is allowed. A predicted rating is not.** These are
  easy to confuse, so: the score is a **percentile against the spread of the 23
  bottles he has rated** (`palateMatch()`), built out of ordering, which is the
  thing palate-v1 does well. It runs 0-100, never 1-5, it sits in the display
  face and never in the rating circles. What stays banned is a number on the
  1-5 scale: "4.2 out of 5" is a prediction the model cannot make. Do not "fix"
  the score by deleting it, and do not rescale it to five.
- **The score and the count are two different claims.** The number is the
  percentile; the badge above it is the literal position ("ahead of 20 of the
  23 you have rated"). Say each once. Putting the count in the score's own
  sub-line makes the number look like it was counted, which it was not.
- **A single bottle gets a rank, not a verdict.** "Ahead of 21 of the 23 you
  have rated" is a position among real bottles, and it is the sub-line under
  the score for exactly that reason.
- **Never print a cellar bottle's real rating beside a new one.** Under "closest
  in your cellar" the anchors are names only. Their true scores are in the data
  and putting one next to a new bottle reads as a prediction for the new bottle,
  which is the banned thing wearing a disguise.
- **The style axes are style, never quality.** A 9 for tannin is not a good
  score, and the heading says "1 to 10" rather than "out of 10" for that reason.
- **Dryness is described, never ranked on.** It is the fourth row in the style
  stack and it is *not* in `palate.json`'s `axesUsed`. It is also the only axis
  with no anchor among his own 23 bottles, so it is the least trustworthy number
  on the screen and the note under the stack says so. Adding it to the
  regression would invalidate the fitted coefficients; if you ever want it
  ranked on, score the 23 for dryness first and refit.
- **Show both outcomes of the brewery check.** Printing nothing when a brewery
  is unconfirmed makes "checked and real" look identical to "never looked",
  which is the whole value of checking. And an unconfirmed brewery is reported
  as unconfirmed, never as wrong: four of seventeen real breweries missed in
  testing, so a miss is weak evidence and the copy must say so.
- **Spirits get no corroboration furniture.** There is no open distillery
  database, so the screen must not imply a check happened.
- Beer and Spirits rank nothing. Do not give them ranking furniture.
