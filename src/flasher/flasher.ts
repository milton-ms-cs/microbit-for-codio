/**
 * One-button micro:bit flasher for Codio assignments.
 *
 * Flow: gate checks (browser support, top-level tab) → single "Send to
 * micro:bit" button that connects if needed and flashes the student's file,
 * with kid-readable progress, mapped errors, and a serial panel that opens
 * automatically when the program crashes on the device.
 */

import { ConnectionStatus, ProgressStage } from "@microbit/microbit-connection";
import {
  createUSBConnection,
  DeviceSelectionMode,
  type MicrobitUSBConnection,
} from "@microbit/microbit-connection/usb";
import { MicropythonFsHex, microbitBoardId } from "@microbit/microbit-fs";
import { explainError, UnsupportedBoardError } from "../shared/errors";
import { loadFirmware } from "../shared/firmware-cache";
import { fetchStudentFile, getTargetFilename } from "../shared/student-file";

// Injected by the build (scripts/build.mjs) from the firmware/ directory.
declare const __FIRMWARE_FILENAME__: string;
declare const __TOOLS_VERSION__: string;

const el = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const gate = el<HTMLDivElement>("gate");
const app = el<HTMLDivElement>("app");
const sendBtn = el<HTMLButtonElement>("sendBtn");
const statusDiv = el<HTMLDivElement>("status");
const stepsList = el<HTMLOListElement>("steps");
const progressBar = el<HTMLProgressElement>("progress");
const filenameSpan = el<HTMLSpanElement>("filename");
const serialPanel = el<HTMLDetailsElement>("serialPanel");
const serialOut = el<HTMLPreElement>("serialOut");
const versionSpan = el<HTMLSpanElement>("version");

const targetFilename = getTargetFilename();

let usb: MicrobitUSBConnection | undefined;
let fsPromise: Promise<MicropythonFsHex> | undefined;
let busy = false;
let lastFlashAt = 0;
let serialBuffer = "";
let crashShown = false;

type StatusKind = "info" | "success" | "error";

function setStatus(kind: StatusKind, message: string, steps: string[] = []) {
  statusDiv.textContent = message;
  statusDiv.className = kind;
  stepsList.innerHTML = "";
  for (const step of steps) {
    const li = document.createElement("li");
    li.textContent = step;
    stepsList.appendChild(li);
  }
  stepsList.style.display = steps.length ? "block" : "none";
}

function showProgress(value: number | undefined) {
  if (value === undefined) {
    progressBar.style.display = "none";
  } else {
    progressBar.style.display = "block";
    progressBar.value = value * 100;
  }
}

// ---------------------------------------------------------------------------
// Environment gate: WebUSB needs Chrome/Edge AND a top-level tab. Inside the
// Codio IDE, guide links can open in an embedded preview frame where
// requestDevice() is blocked by Permissions Policy — that's the historical
// "works for some kids, not others" failure. Detect it and hand the kid a
// pop-out link instead of a broken button.
// ---------------------------------------------------------------------------
function checkEnvironment(): "ok" | "framed" | "unsupported" {
  if (!navigator.usb) {
    return "unsupported";
  }
  try {
    if (window.self !== window.top) {
      return "framed";
    }
  } catch {
    return "framed"; // cross-origin parent throws on access — definitely framed
  }
  return "ok";
}

function showGate(kind: "framed" | "unsupported") {
  app.style.display = "none";
  gate.style.display = "block";
  if (kind === "framed") {
    const url = new URL(window.location.href);
    gate.innerHTML = `
      <h2>One more step!</h2>
      <p>The micro:bit uploader needs its own browser tab.</p>
      <a class="bigbtn" href="${url.toString()}" target="_blank" rel="noopener">
        Open the micro:bit uploader ↗
      </a>`;
  } else {
    gate.innerHTML = `
      <h2>This browser can't talk to a micro:bit</h2>
      <p>Please use <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> on a computer.</p>
      <p>No micro:bit handy? You can still test your code in the simulator
         from the assignment page.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------
function createConnection(): MicrobitUSBConnection {
  const connection = createUSBConnection({
    // Silently reconnect to a previously-granted micro:bit; only show the
    // browser picker when we've never been given one.
    deviceSelectionMode: DeviceSelectionMode.UseAnyAllowed,
  });
  connection.addEventListener("serialdata", ({ data }) => {
    appendSerial(data);
  });
  connection.addEventListener("serialreset", () => {
    serialBuffer = "";
    serialOut.textContent = "";
    crashShown = false;
  });
  return connection;
}

async function resetConnection() {
  if (usb) {
    try {
      await usb.disconnect();
    } catch {
      // Already broken — that's why we're resetting.
    }
    usb.dispose();
  }
  usb = createConnection();
  await usb.initialize();
}

// ---------------------------------------------------------------------------
// Serial panel: collect device output; if the program crashes right after a
// flash, open the panel so the kid sees the Python error instead of a blank
// screen.
// ---------------------------------------------------------------------------
function appendSerial(data: string) {
  serialBuffer = (serialBuffer + data).slice(-20000);
  serialOut.textContent = serialBuffer;
  serialOut.scrollTop = serialOut.scrollHeight;
  const recentFlash = Date.now() - lastFlashAt < 30000;
  if (!crashShown && recentFlash && serialBuffer.includes("Traceback (most recent call last)")) {
    crashShown = true;
    serialPanel.open = true;
    setStatus(
      "error",
      "Your program was sent, but it has an error. Look at the message from your micro:bit below — it tells you which line to fix.",
    );
  }
}

// ---------------------------------------------------------------------------
// Hex building: parse the 1.2 MB firmware once, then only rewrite main.py
// between flashes.
// ---------------------------------------------------------------------------
function getFilesystem(): Promise<MicropythonFsHex> {
  if (!fsPromise) {
    fsPromise = (async () => {
      const firmware = await loadFirmware(__FIRMWARE_FILENAME__);
      return new MicropythonFsHex([
        { hex: firmware, boardId: microbitBoardId.V2 },
      ]);
    })();
    // Allow retry if the firmware fetch failed.
    fsPromise.catch(() => {
      fsPromise = undefined;
    });
  }
  return fsPromise;
}

// ---------------------------------------------------------------------------
// The one button
// ---------------------------------------------------------------------------
function progressText(stage: ProgressStage, value?: number): string {
  const pct = value === undefined ? "" : ` ${Math.round(value * 100)}%`;
  switch (stage) {
    case ProgressStage.PartialFlashing:
      return `Sending your program…${pct}`;
    case ProgressStage.FullFlashing:
      return `Setting up the micro:bit (first time takes about a minute)…${pct}`;
    case ProgressStage.Connecting:
      return "Connecting to your micro:bit…";
    default:
      return "Looking for your micro:bit…";
  }
}

async function send() {
  if (busy || !usb) {
    return;
  }
  if (!targetFilename) {
    setStatus("error", "This page was opened with a bad file name in the link. Tell your teacher.");
    return;
  }
  busy = true;
  sendBtn.disabled = true;
  sendBtn.textContent = "Sending…";
  serialPanel.open = false;
  crashShown = false;

  const progress = (stage: ProgressStage, value?: number) => {
    setStatus("info", progressText(stage, value));
    showProgress(
      stage === ProgressStage.PartialFlashing || stage === ProgressStage.FullFlashing
        ? value
        : undefined,
    );
  };

  try {
    setStatus("info", `Reading ${targetFilename}…`);
    const code = await fetchStudentFile(targetFilename);

    setStatus("info", "Getting the micro:bit software ready…");
    const fs = await getFilesystem();
    fs.write("main.py", code);

    if (usb.status !== ConnectionStatus.Connected) {
      setStatus("info", "Connecting to your micro:bit…");
      await usb.connect({ progress });
    }

    await usb.flash(
      async (boardVersion) => {
        if (boardVersion !== "V2") {
          throw new UnsupportedBoardError();
        }
        return fs.getIntelHex(microbitBoardId.V2);
      },
      { partial: true, progress },
    );

    lastFlashAt = Date.now();
    showProgress(undefined);
    setStatus("success", "🎉 Done! Your program is running on the micro:bit.");
    sendBtn.textContent = "Send again";
  } catch (error) {
    console.error("[flasher]", error);
    showProgress(undefined);
    const kid = explainError(error);
    setStatus("error", `😕 ${kid.title}`, kid.steps);
    sendBtn.textContent = "Try again";
    // A fresh connection clears stale DAPLink/WebUSB state, which is the
    // usual cure for repeated flash failures.
    await resetConnection();
  } finally {
    busy = false;
    sendBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  versionSpan.textContent = __TOOLS_VERSION__;
  filenameSpan.textContent = targetFilename ?? "(invalid file name)";

  const env = checkEnvironment();
  if (env !== "ok") {
    showGate(env);
    return;
  }

  usb = createConnection();
  await usb.initialize();
  sendBtn.addEventListener("click", () => void send());
  setStatus(
    "info",
    "Plug in your micro:bit with a USB cable, then click the button.",
  );
  // Warm the firmware cache while the kid reads the page.
  void getFilesystem().catch(() => {});
}

void init();
