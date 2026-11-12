# README preview images

Regenerates the pictures of the web UI in the main README, in `docs/assets`:

| Image | Shows |
| :---- | :---- |
| `ui-preview.png` | The hero at the top: the Mission control dashboard on a laptop and the Session list on a phone. |
| `ui-gallery-chat.png` | A Session's chat on a laptop: agent activity, an Edit diff, and a permission request. |
| `ui-gallery-dashboard.png` | Mission control on a phone. |
| `ui-gallery-activity.png` | The same chat on a phone. |
| `ui-gallery-question.png` | A question from the agent, with options. |

This folder is separate from the app: it has its own `package.json`, and its dependency (`puppeteer-core`) is not part of the root `package.json`, the type check or the tests.

## Run it

```bash
tools/readme-preview/run.sh
```

It builds the web UI, starts a throwaway Bridge with demo data, takes the screenshots in headless Chrome, frames them as a laptop or a phone, and writes the final PNGs.

## Choose the theme

The images use the **Remote Agent** theme in **dark** mode. To use another theme, set these before running:

| Variable | Default | Meaning |
| :------- | :------ | :------ |
| `PREVIEW_PALETTE` | `default` | A palette id from `src/ui/themes.ts`. |
| `PREVIEW_MODE` | `dark` | `light` or `dark`. |
| `PREVIEW_BEZEL` | `#050b22` | The color of the laptop and phone frames. |

For example, a Gruvbox version: `PREVIEW_PALETTE=gruvbox PREVIEW_MODE=dark PREVIEW_BEZEL='#1d2021' tools/readme-preview/run.sh`.

The fonts come from the app, which bundles Inter, Space Grotesk and IBM Plex Mono, so the shots look the same on any machine.

## What it needs

- [Bun](https://bun.sh)
- Google Chrome or Chromium (set `CHROME` if it is not on your `PATH`)
- Python 3 with [Pillow](https://pillow.readthedocs.io). Pillow built with libimagequant keeps the soft shadows smooth and the files small.

## Why it is safe to run

Your real Bridge is never touched. The throwaway Bridge uses its own port (`PREVIEW_PORT`, default `8799`, plus the next port for a small proxy), database, socket and `HOME`, all under `WORK_DIR` (default `/tmp/ra-preview`). It runs from that folder, so a `.env` in the repository is not loaded.

The demo data is made up: the projects `web-app`, `api-service`, `docs-site` and `mobile-app`, and the login `demo@example.com`. Look at the results before you commit them, to be sure nothing real slipped in.

## Debugging

Set `PREVIEW_HOLD=<seconds>` to keep the throwaway Bridge and proxy running after the data is seeded, so you can open the UI or point your own script at it. The URL is printed.

## Files

| File | Purpose |
| :--- | :------ |
| `run.sh` | Runs every step and cleans up the throwaway Bridge and proxy. |
| `seed.sh` | Posts the demo Sessions, Prompts, usage and Reports to the Bridge's socket. |
| `transcripts.mjs` | Writes demo Claude Code transcripts, so the chats show agent text, tool runs and an Edit diff. |
| `proxy.mjs` | A small stand-in for `tailscale serve` that adds the identity header, including on the WebSocket. |
| `capture.mjs` | Takes the laptop (1440×900) and phone (390×844) screenshots in the chosen theme. |
| `compose.html`, `gallery.html`, `compose.mjs` | Place the screenshots in simple device frames on a transparent background. |
| `optimize.py` | Trims the margins, scales to a width, and shrinks each PNG. |
