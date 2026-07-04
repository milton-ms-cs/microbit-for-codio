# micro:bit tools for Codio

A self-contained **combined simulator + flasher page** for micro:bit assignments
in Codio, designed to be installed **once** into a Codio stack and used by every
micro:bit assignment via plain guide links — no per-assignment file copying.

Kids edit in Codio's editor (playback history intact); this page is everything
that happens *after* the code exists.

## The one page

Since v1.1 there is a single combined page, built to **both** `flasher.html` and
`simulator.html` filenames so existing guide links keep working. Top to bottom:

- **Simulator** — embeds the micro:bit Foundation's hosted Python simulator (the
  same one python.microbit.org uses) and posts the student's file into it.
  Works everywhere, including inside Codio's embedded preview frame. Opt-in
  "Run again when I come back to this tab" checkbox re-runs it with the latest
  code whenever the kid switches back from Codio.
- **🔌 Send to a real micro:bit** — one-button WebUSB uploader. Connects
  (silently reusing a previously-chosen device), builds a MicroPython hex with
  the student's file, partial-flashes it, and shows kid-readable errors with
  troubleshooting steps. Adapts to where it finds itself:
  - *Top-level Chrome/Edge tab*: live Send button (with an inline picture of the
    browser's device picker the first time).
  - *Inside Codio's preview frame* (WebUSB blocked by Permissions Policy): shows
    a pop-out button instead of failing mysteriously — the simulator still works
    right there.
  - *No WebUSB at all* (Safari/Firefox): offers a **⬇ Download .hex** fallback —
    the micro:bit mounts as a plain USB drive, so drag-and-drop flashes it in
    any browser. The same fallback is linked under the Send button for kids
    whose USB connection is being stubborn.
- **Messages from your program** — one shared log for simulator serial and
  device serial (`[sim]` / `[micro:bit]` prefixes). If the program crashes on
  the device, the status calls out **which line of the student's file** to fix.

Guard rails: refuses to send an empty file; warns when a re-send contains
exactly the same code as the last send ("did your changes save in Codio?");
V2-only firmware with a friendly message on V1 boards; forgets a remembered
device that reports `firmware-update-required` so retrying re-prompts.

The page is built into a **single self-contained HTML file** — the only runtime
fetches are the student's `.py` file, the firmware hex sitting next to the page
(cached in the browser after the first download), and the pinned simulator
iframe. No CDNs.

## How assignments use it

Guide markdown links, with the student's filename in the query string:

```markdown
[▶ Test your program](microbit-tools/simulator.html?file=try_it.py)
```

(`flasher.html` and `simulator.html` are the same page; use whichever reads
better in the guide. `?file=` defaults to `main.py`.)

The page looks for the `.py` file first in its own directory, then in the
parent directory — so it works both from `workspace/microbit-tools/`
(stack-installed) and from the workspace root (legacy copies).

Add `microbit-tools/` to the assignment's `.assignmentignore`.

## Notes for teachers

- **The device picker reappears once per assignment.** WebUSB permission is
  per-origin and every Codio box has a unique subdomain, so kids re-choose
  "BBC micro:bit" the first time they send in each assignment. The page shows a
  picture of what to click.
- **School web filter**: the simulator loads from
  `https://python-simulator.usermbit.org` — make sure it's allowlisted, or the
  simulator shows a load-timeout after 15 seconds.
- **Fixing a board that says it needs a firmware update**: follow
  <https://microbit.org/get-started/user-guide/firmware/> (drag a firmware hex
  onto the board in MAINTENANCE mode — takes about 2 minutes). General WebUSB
  troubleshooting:
  <https://support.microbit.org/support/solutions/articles/19000105428-webusb-troubleshooting>.

## Repo layout

```
src/app/         the combined page (TypeScript + HTML shell)
src/shared/      ?file= validation/fetch, error→kid-message mapping, firmware cache
firmware/        exactly one pinned, versioned MicroPython hex (v2.x.x for micro:bit V2)
scripts/build.mjs  esbuild → dist/ (bundled, minified, inlined into the HTML,
                   written to both flasher.html and simulator.html)
stack/install.sh   run in a box you're about to snapshot as a stack
stack/startup.sh   installed to /home/codio/startup.sh; copies dist → workspace at
                   box start, ONLY when .codio marks a micro:bit assignment
                   (greps for the "micro:bit" button label)
```

Pinned dependencies: `@microbit/microbit-connection@1.0.0-beta.1` and
`@microbit/microbit-fs@0.10.0` (the same pair the official micro:bit Python
Editor uses).

Not implemented (yet): serial *input* to the device — no assignment uses
`input()` over serial so far.

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
4. Flash code with a deliberate `NameError` → the log shows the traceback and the status names the line number.
5. Send the same code twice → "same code as your last send" notice on the second.
6. Empty `main.py` → refused with a friendly message (both Send and Download .hex).
7. **⬇ Download .hex** → drag the file onto the MICROBIT drive → program runs.
8. Simulator: ▶ Run works framed inside Codio AND popped out; auto-run checkbox re-runs on tab focus.

## Releasing

```bash
git tag v1.1.0 && git push origin v1.1.0
```

GitHub Actions builds `dist/` and attaches `microbit-tools-v1.1.0.tar.gz` to a
GitHub Release.

## Creating / upgrading the Codio stack

1. Open any Codio project, in the terminal:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/milton-ms-cs/microbit-for-codio/main/stack/install.sh | sudo bash -s v1.1.0
   ```
2. Codio menu ▸ **Project ▸ Stack ▸ Create** (or **Add Version** to the existing
   "microbit-tools" stack).
3. Point assignments at the new stack version deliberately — assignments pin a
   stack version, so classes mid-unit never change underneath the kids.

At box start, `startup.sh` copies the tools into `workspace/microbit-tools/` —
**only in micro:bit assignments** (it greps the workspace `.codio` for the
"micro:bit" button label, so python/graphics/webdev boxes stay clean). It also
replaces legacy per-assignment copies of `index.html` / `simulator.html`
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
`src/`. v1.0 had separate `src/flasher/` and `src/simulator/` pages; they were
merged into `src/app/` in v1.1 (both dist filenames still ship).
