<h1 align="center">Glasscast</h1>

<p align="center">
  <b>Open-source screen recorder & editor for macOS</b><br/>
  Record, auto-zoom, polish, and export cinematic demos — with a bring-your-own-key AI agent built in.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%2014%2B-111827?style=for-the-badge&logo=apple&logoColor=white" alt="macOS 14+" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0-2563eb?style=for-the-badge" alt="AGPL 3.0 license" />
  <a href="https://kk926phm.insforge.site"><img src="https://img.shields.io/badge/website-glasscast-ff3b30?style=for-the-badge" alt="Website" /></a>
</p>

---

## What is Glasscast?

Glasscast is a desktop screen recorder with a motion-design editor built in. Instead of handing raw footage to a motion designer just to get zooms, cursor polish, or a styled background, you record, edit, and export in one app.

- **Record** a display or a single window, with mic + system audio, using native ScreenCaptureKit capture.
- **Edit** on a drag-and-drop timeline: trims, manual + automatic zooms, speed regions, annotations, extra audio, crops.
- **Polish** with smoothed cursor rendering (size, motion blur, click bounce, sway), webcam bubble overlays, and styled frames (wallpapers, gradients, blur, padding, shadows, aspect-ratio presets).
- **AI, your keys**: an in-editor AI agent and auto-captions. Glasscast ships **zero API keys** — add your own OpenAI / Anthropic / OpenRouter key (and OpenAI / Groq / Deepgram for captions, or run local Whisper). Keys are stored encrypted on-device.
- **Export** MP4 or GIF, with quality, frame-rate, loop, and size controls.
- Save and reopen work as `.glasscast` project files.

**Platform:** macOS 14+ (Apple Silicon builds published; Intel can build from source). The codebase contains Windows/Linux capture paths inherited from upstream, but Glasscast does not ship or test those platforms today.

---

## Install

Grab the latest `.dmg` from **[Releases](https://github.com/henrybrewer00-dotcom/Glasscast/releases)**, drag Glasscast to Applications, and on first record grant **System Settings → Privacy & Security → Screen Recording → Glasscast**, then relaunch.

Locally built or unsigned copies may get quarantined by macOS:

```bash
xattr -rd com.apple.quarantine /Applications/Glasscast.app
```

---

## Build from source

### Recommended: set it up with an AI agent

Glasscast is a large Electron + native project, so the fastest path is letting a coding agent (Claude Code, Cursor, Codex, …) drive the setup. Clone the repo, open your agent **in the project root**, and paste this prompt:

```text
Set up and run Glasscast — this is an Electron + Vite + React + TypeScript desktop app.

1. Check prerequisites: Node.js 20+, and on macOS the Xcode Command Line Tools
   (run `xcode-select -p`; if it errors, tell me to run `xcode-select --install`).
2. Run `npm install`. Its `postinstall` step compiles native Swift/C++ helpers — if
   that fails, read the error and fix the missing toolchain rather than skipping it.
3. Start the app in dev with `npm run dev`. If I want a packaged installer instead,
   run `npm run build:mac` and tell me where it landed (the `release/` folder).
4. Run `npm test` and confirm the suite passes.
5. Tell me how to grant Screen Recording permission the first time I record:
   System Settings → Privacy & Security → Screen Recording → enable Glasscast,
   then relaunch the app.
6. Explain bring-your-own-key AI: Glasscast ships no API keys. In the editor open
   the "AI Keys" tab to add an OpenAI, Anthropic, or OpenRouter key for the AI
   agent, and add a captions key (OpenAI / Groq / Deepgram) or use local Whisper.
   Keys are stored encrypted on-device and are never committed.

Don't commit anything or add new dependencies without asking me first. If a step
fails, show me the exact error and your proposed fix before continuing.
```

### Manual

Prerequisites: Node.js 20+, Xcode Command Line Tools (`xcode-select --install`).

```bash
git clone https://github.com/henrybrewer00-dotcom/Glasscast.git glasscast
cd glasscast
npm install
npm run dev        # development
npm run build:mac  # packaged build → release/
```

---

## How it works

- **Capture** — Electron coordinates recording; native Swift helpers (ScreenCaptureKit) handle window/display enumeration, capture, and cursor data.
- **Editing** — timeline regions define zooms, trims, speed changes, audio overlays, and annotations; cursor and webcam styling live in editor state.
- **Rendering** — scene composition is **PixiJS**; the same scene logic drives both preview and export.
- **Projects** — `.glasscast` files store the source media path plus editor state.

---

## Contributing

PRs welcome — UI/UX refinement, export performance, editor tools, and localisation are all good places to help. Keep PRs focused, test the record → edit → export flow, and avoid unrelated refactors. See `CONTRIBUTING.md`.

Bugs & feature requests: [issues](https://github.com/henrybrewer00-dotcom/Glasscast/issues).

---

## License & credits

Glasscast is licensed under the **[AGPL-3.0](LICENSE.md)**.

Glasscast builds on **[Recordly](https://github.com/webadderallorg/Recordly)** (AGPLv3) by webadderall, itself derived from **[OpenScreen](https://github.com/siddharthvaddem/openscreen)** by Siddharth Vaddem. Much of Glasscast has been rewritten or built fresh, but Recordly's source was referenced many times along the way — especially the macOS screen-recording permissions flow — and portions of its code remain. Full credit and thanks to webadderall, the Recordly contributors, and Siddharth Vaddem. As the AGPLv3 requires, Glasscast is distributed under the same license.
