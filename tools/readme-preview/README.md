# README preview image

Regenerates `docs/assets/ui-preview.png`, the laptop and phone picture at the top of the main README.

This folder is separate from the app: it has its own `package.json`, and its dependency (`puppeteer-core`) is not part of the root `package.json`, the type check or the tests.

## Run it

```bash
tools/readme-preview/run.sh
```

It builds the web UI, starts a throwaway Bridge with demo data, takes the screenshots in headless Chrome, frames them as a laptop and a phone, and writes the final PNG.

## Choose the theme

The image uses the **Gruvbox** theme in **dark** mode. To use another theme, set these before running:

| Variable | Default | Meaning |
| :------- | :------ | :------ |
| `PREVIEW_PALETTE` | `gruvbox` | A palette id from `src/ui/themes.ts`. |
| `PREVIEW_MODE` | `dark` | `light` or `dark`. |
| `PREVIEW_BEZEL` | `#1d2021` | The color of the laptop and phone frames. |

For example, the original light picture: `PREVIEW_PALETTE=default PREVIEW_MODE=light PREVIEW_BEZEL='#050b22' tools/readme-preview/run.sh`.

## What it needs

- [Bun](https://bun.sh)
- Google Chrome or Chromium (set `CHROME` if it is not on your `PATH`)
- Python 3 with [Pillow](https://pillow.readthedocs.io). Pillow built with libimagequant keeps the soft shadows smooth and the file small.

## Why it is safe to run

Your real Bridge is never touched. The throwaway Bridge uses its own port (`PREVIEW_PORT`, default `8799`), database, socket and `HOME`, all under `WORK_DIR` (default `/tmp/ra-preview`). It runs from that folder, so a `.env` in the repository is not loaded.

The demo data is made up: the projects `web-app`, `api-service`, `docs-site` and `mobile-app`, and the login `demo@example.com`. Look at the result before you commit it, to be sure nothing real slipped in.

## Files

| File | Purpose |
| :--- | :------ |
| `run.sh` | Runs every step and cleans up the throwaway Bridge. |
| `seed.sh` | Posts the demo Sessions, Prompts, usage and Reports to the Bridge's socket. |
| `capture.mjs` | Takes the laptop (1440×900) and phone (390×844) screenshots in the chosen theme. |
| `compose.html`, `compose.mjs` | Place the screenshots in simple device frames on a transparent background. |
| `optimize.py` | Trims the margins, scales to 1600px wide, and shrinks the PNG. |
