# Card art bundle

The app loads card images from Scryfall's CDN and keeps them in a browser cache. Some hosts don't allow
that: a page that may only load its own files shows every card as a drawn stand-in. For those hosts the
images can be shipped with the app.

`build.mjs` downloads the most-played cards' scans (by EDHREC rank), re-encodes them as WebP and
concatenates them into pack files of about equal size, with a `manifest.json` that says where each image
is. The first cards get a large size (sharp in a preview), the rest a smaller one, until the size budget
is used up; a card's printings under other names and the printed tokens it makes come with it, at the
smaller size. Nothing is cropped or retouched: the artist and copyright line stay on every card.

The **Card art bundle** workflow runs it on GitHub (which can reach the CDN) and publishes the result to
the `art` branch. Its settings are `request.json`; the workflow runs whenever that file changes on main
(or from the Actions tab):

```
git fetch origin art && mkdir -p apps/web/public/art && git archive FETCH_HEAD | tar -x -C apps/web/public/art
```

(or copy the files into an `art` folder next to the built app).

The app looks for `art/manifest.json` beside itself at start-up. With one, a card whose image is in the
bundle is drawn from it (a pack is fetched when a card in it first comes into view); any other card falls
back to the CDN, then to the drawn stand-in. Without one, nothing changes.

`extra.txt` lists cards to include whatever their rank. `--fake` draws placeholder images instead of
downloading, for testing the bundle offline.
