# micro:bit tools for Codio

Self-contained flasher and simulator pages for micro:bit assignments in Codio,
designed to be installed **once** into a Codio stack and used by every
micro:bit assignment via plain guide links — no per-assignment file copying.

## What's here

| Page | What it does |
| --- | --- |
| `flasher.html` | One-button WebUSB uploader: "Send to micro:bit". Connects (silently reusing a previously-chosen device), builds a MicroPython hex with the student's file, partial-flashes it, and shows kid-readable errors with troubleshooting steps. Auto-opens a "messages from your micro:bit" panel when the program crashes on the device so kids see the Python traceback. Detects when it has been opened inside the Codio IDE frame (where WebUSB is blocked) and shows a pop-out button instead of failing mysteriously. |
| `simulator.html` | Embeds the micro:bit Foundation's hosted Python simulator and posts the student's file into it. |

Both pages are built into **single self-contained HTML files** — the only
runtime fetches are the student's `.py` file, the firmware hex sitting next to
the page (cached in the browser after the first download), and (simulator
only) the pinned simulator iframe. No CDNs.

## How assignments use it

Guide markdown links, with the student's filename in the query string:

```markdown
[▶ Test in Simulator](microbit-tools/simulator.html?file=try_it.py)
[⬆ Send to micro:bit](microbit-tools/flasher.html?file=try_it.py)
```

The pages look for the `.py` file first in their own directory, then in the
parent directory — so they work both from `workspace/microbit-tools/`
(stack-installed) and from the workspace root (legacy copies).

Add `microbit-tools/` to the assignment's `.assignmentignore`.

## Repo layout

```
src/flasher/     flasher page (TypeScript + HTML shell)
src/simulator/   simulator page
src/shared/      ?file= validation/fetch, error→kid-message mapping, firmware cache
firmware/        exactly one pinned, versioned MicroPython hex (v2.x.x for micro:bit V2)
scripts/build.mjs  esbuild → dist/ (bundled, minified, inlined into the HTML)
stack/install.sh   run in a box you're about to snapshot as a stack
stack/startup.sh   installed to /home/codio/startup.sh; copies dist → workspace at box start
```

Pinned dependencies: `@microbit/microbit-connection@1.0.0-beta.1` and
`@microbit/microbit-fs@0.10.0` (the same pair the official micro:bit Python
Editor uses).

## Developing

```bash
npm ci
npm run build     # → dist/
npm run serve     # http://localhost:8000 — flash a real micro:bit from Chrome
npx tsc --noEmit  # typecheck
```

Manual hardware checklist before releasing:
1. Flash a real V2 twice — the second flash must say "Sending your program…" (partial) and take seconds.
2. Unplug mid-flash → friendly error → "Try again" works.
3. Flash from a second tab while the first is open → "another tab" message.
4. Flash code with a deliberate `NameError` → the messages panel opens itself showing the traceback.

## Releasing

```bash
git tag v1.0.1 && git push origin v1.0.1
```

GitHub Actions builds `dist/` and attaches `microbit-tools-v1.0.1.tar.gz` to a
GitHub Release.

## Creating / upgrading the Codio stack

1. Open any Codio project, in the terminal:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/bsitkoff/microbit_for_codio/main/stack/install.sh | sudo bash -s v1.0.1
   ```
2. Codio menu ▸ **Project ▸ Stack ▸ Create** (or **Add Version** to the existing
   "microbit-tools" stack).
3. Point assignments at the new stack version deliberately — assignments pin a
   stack version, so classes mid-unit never change underneath the kids.

At box start, `startup.sh` copies the tools into `workspace/microbit-tools/`.
It also replaces legacy per-assignment copies of `index.html` / `simulator.html`
(detected by their esm.sh / unversioned markers) so old assignments get the fix
without editing their guides.

## Upgrading the MicroPython firmware

Replace the single hex in `firmware/` with the new release from
<https://github.com/microbit-foundation/micropython-microbit-v2/releases>,
keeping the versioned filename (e.g. `micropython-microbit-v2.1.2.hex`).
The build injects the filename into the page, and the versioned name is the
browser cache key, so caches invalidate automatically.

## Legacy

The repo root previously held copy-into-every-assignment `index.html` /
`simulator.html` / `microbit-micropython-v2.hex`; those are gone — build from
`src/` instead.
