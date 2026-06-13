# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The personal website of Justin Cranshaw, served at **cranshaw.me** (custom domain in `CNAME`) via **GitHub Pages** from the `master` branch of the `utisz/utisz.github.io` repo. There is no build step, package manager, or test suite — files are served verbatim. Pushing to `master` deploys.

To preview locally, open `index.html` in a browser or run any static server (e.g. `python3 -m http.server`).

## Structure

- `index.html` — the live single-page site. Self-contained: inline CSS link + an inline Three.js script that animates drifting clouds on a full-screen `<canvas id="cloudCanvas">`. Content is a short bio with social links (FontAwesome icons via CDN).
- `assets/new-style.css` — the **active** stylesheet for `index.html`. The gradient background, `.container` card, and fonts (Oswald + Roboto via Google Fonts) live here.
- `old.html` + `assets/style.css` + `assets/bootstrap.*` + `assets/jquery.min.js` + `assets/ga.js` — the **previous** version of the site (Bootstrap-based, with the full academic publication list and Google Analytics). Not linked from the live site; kept for reference. The `old` / `old-website` branches preserve it too.
- `papers/` — PDFs of academic publications, linked from `old.html`.
- `assets/cranshaw-dissertation.pdf` — linked from the live `index.html`.
- Favicon / PWA assets (`favicon*`, `*-chrome-*.png`, `apple-touch-icon.png`, `mstile-*.png`, `site.webmanifest`, `browserconfig.xml`) — generated icon set referenced by `index.html`.
- `cloud.png` — texture loaded by the Three.js cloud animation in `index.html`.

## Editing notes

- When changing the live site, edit `index.html` and `assets/new-style.css`. Do **not** edit `old.html` / `style.css` expecting changes to appear live — they aren't linked.
- External dependencies (Three.js r128, FontAwesome 6.5.1, Google Fonts) load from CDNs, not vendored.
- Keep paths root-absolute (`/assets/...`, `/favicon-32x32.png`) — they resolve against the domain root on GitHub Pages.
