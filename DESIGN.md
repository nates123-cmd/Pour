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
`rel` — its distance from that list's own average, which is the only fit number
the model is honest enough to show. That is the book's grape-cluster motif doing
actual work. Never colour a circle by anything else.

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
  rating and is not one. Show `rel`, as a circle and as a position in the order.
- **The ranked list is an order, not a scoreboard.** Nothing on screen may
  suggest a wine scored 4.2 out of 5.
- Beer and Spirits rank nothing. Do not give them ranking furniture.
