/**
 * The one micro:bit page for Codio assignments: simulator + one-button flasher.
 *
 * The kid keeps this page open in its own tab next to Codio: edit in Codio,
 * ▶ Run in the simulator, 🔌 Send to the real micro:bit — one shared output log.
 *
 * WebUSB only works in a top-level tab (Codio's embedded preview frame blocks
 * requestDevice via Permissions Policy), so the flash section adapts to where
 * it finds itself: real Send button in a top-level Chrome/Edge tab, a pop-out
 * link when framed, and a download-the-hex fallback when the browser has no
 * WebUSB at all. The simulator works everywhere.
 */

import {
  ConnectionStatus,
  DeviceError,
  ProgressStage,
} from "@microbit/microbit-connection";
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

const SIMULATOR_ORIGIN = "https://python-simulator.usermbit.org";
const AUTORUN_STORAGE_KEY = "microbit-tools-autorun";

const el = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// Simulator section
const runBtn = el<HTMLButtonElement>("runBtn");
const stopBtn = el<HTMLButtonElement>("stopBtn");
const resetBtn = el<HTMLButtonElement>("resetBtn");
const simStatus = el<HTMLSpanElement>("simStatus");
const simulatorFrame = el<HTMLIFrameElement>("simulator");
const autoRunCheckbox = el<HTMLInputElement>("autoRun");

// Flash section
const flashFramed = el<HTMLDivElement>("flashFramed");
const flashUnsupported = el<HTMLDivElement>("flashUnsupported");
const flashLive = el<HTMLDivElement>("flashLive");
const popoutLink = el<HTMLAnchorElement>("popoutLink");
const sendBtn = el<HTMLButtonElement>("sendBtn");
const statusDiv = el<HTMLDivElement>("status");
const stepsList = el<HTMLOListElement>("steps");
const progressBar = el<HTMLProgressElement>("progress");
const pickerHelp = el<HTMLDivElement>("pickerHelp");
const hexDownloadLink = el<HTMLAnchorElement>("hexDownloadLink");
const hexDownloadBtn2 = el<HTMLButtonElement>("hexDownloadBtn2");
const hexSteps = el<HTMLOListElement>("hexSteps");

// Shared
const output = el<HTMLPreElement>("output");
const filenameSpan = el<HTMLSpanElement>("filename");
const versionSpan = el<HTMLSpanElement>("version");

const targetFilename = getTargetFilename();

let usb: MicrobitUSBConnection | undefined;
let fsPromise: Promise<MicropythonFsHex> | undefined;
let busy = false;
let serialLineBuffer = "";
let tracebackBuffer = "";
let crashShown = false;
let lastFlashedCode: string | undefined;
let simulatorReady = false;
let lastAutoRunAt = 0;

// ---------------------------------------------------------------------------
// Shared output log: simulator serial and device serial, one place, prefixed.
// ---------------------------------------------------------------------------
function logOutput(source: "sim" | "micro:bit" | "page", message: string) {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = source === "page" ? "" : `[${source}] `;
  const lines = `${output.textContent ?? ""}[${timestamp}] ${prefix}${message}\n`.split("\n");
  output.textContent = lines.slice(-500).join("\n");
  output.scrollTop = output.scrollHeight;
}

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
// Environment: decide what the flash section can offer here.
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
    appendDeviceSerial(data);
  });
  connection.addEventListener("serialreset", () => {
    serialLineBuffer = "";
    tracebackBuffer = "";
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
// Device serial → the shared log, line by line; if the program crashes, tell
// the kid which line of their file to look at.
// ---------------------------------------------------------------------------
function appendDeviceSerial(data: string) {
  serialLineBuffer += data;
  const lines = serialLineBuffer.split(/\r?\n/);
  serialLineBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim()) {
      logOutput("micro:bit", line);
    }
  }

  tracebackBuffer = (tracebackBuffer + data).slice(-5000);
  if (
    !crashShown &&
    tracebackBuffer.includes("Traceback (most recent call last)") &&
    /\n[A-Za-z_]\w*(Error|Exception)\b/.test(tracebackBuffer)
  ) {
    crashShown = true;
    const lineMatches = [
      ...tracebackBuffer.matchAll(/File "main\.py", line (\d+)/g),
    ];
    const lineNumber = lineMatches.length
      ? lineMatches[lineMatches.length - 1][1]
      : undefined;
    setStatus(
      "error",
      lineNumber
        ? `Your program was sent, but it has an error on line ${lineNumber} of ${targetFilename}. The message below has the details.`
        : "Your program was sent, but it has an error. Look at the message below — it tells you which line to fix.",
    );
  }
}

// ---------------------------------------------------------------------------
// Hex building: parse the 1.2 MB firmware once, then only rewrite main.py.
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

async function buildHexWithStudentCode(): Promise<string> {
  if (!targetFilename) {
    throw new Error("bad ?file= parameter");
  }
  const code = await fetchStudentFile(targetFilename);
  if (!code.trim()) {
    throw new EmptyFileError();
  }
  const fs = await getFilesystem();
  fs.write("main.py", code);
  return fs.getIntelHex(microbitBoardId.V2);
}

class EmptyFileError extends Error {
  constructor() {
    super("student file is empty");
    this.name = "EmptyFileError";
  }
}

// ---------------------------------------------------------------------------
// Download-.hex fallback (works in any browser — the micro:bit shows up as a
// plain USB drive, so drag-and-drop flashes it without WebUSB).
// ---------------------------------------------------------------------------
async function downloadHex() {
  const hexFilename = (targetFilename ?? "main.py").replace(/\.py$/, ".hex");
  try {
    logOutput("page", `Building ${hexFilename}…`);
    const hex = await buildHexWithStudentCode();
    const blob = new Blob([hex], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = hexFilename;
    a.click();
    URL.revokeObjectURL(url);
    hexSteps.innerHTML = "";
    for (const step of [
      `Look in your Downloads folder for ${hexFilename}`,
      "Plug in the micro:bit — it appears as a drive called MICROBIT",
      "Drag the .hex file onto the MICROBIT drive and wait for the light to stop blinking",
    ]) {
      const li = document.createElement("li");
      li.textContent = step;
      hexSteps.appendChild(li);
    }
    hexSteps.style.display = "block";
    logOutput("page", `Downloaded ${hexFilename} — drag it onto the MICROBIT drive.`);
  } catch (error) {
    if (error instanceof EmptyFileError) {
      logOutput("page", `❌ ${targetFilename} is empty — write some code first!`);
    } else {
      logOutput("page", `❌ Couldn't build the .hex file. Reload this page and try again.`);
      console.error("[hex-download]", error);
    }
  }
}

// ---------------------------------------------------------------------------
// The one Send button
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
  crashShown = false;
  tracebackBuffer = "";
  hexSteps.style.display = "none";

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
    if (!code.trim()) {
      setStatus("error", `${targetFilename} is empty — write some code in Codio first!`);
      return;
    }
    const sameAsLastSend = code === lastFlashedCode;

    setStatus("info", "Getting the micro:bit software ready…");
    const fs = await getFilesystem();
    fs.write("main.py", code);

    if (usb.status !== ConnectionStatus.Connected) {
      // The browser picker only appears when no micro:bit has been chosen on
      // this page before — show the kid what to click while it's up.
      if (usb.status === ConnectionStatus.NoAuthorizedDevice) {
        pickerHelp.style.display = "block";
      }
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

    lastFlashedCode = code;
    showProgress(undefined);
    if (sameAsLastSend) {
      setStatus(
        "success",
        "Sent — but this is exactly the same code as your last send. If you changed something, check it saved in Codio, then send again.",
      );
    } else {
      setStatus("success", "🎉 Done! Your program is running on the micro:bit.");
    }
    logOutput("page", "▶ Sent to the micro:bit.");
    sendBtn.textContent = "Send again";
  } catch (error) {
    console.error("[flasher]", error);
    showProgress(undefined);
    const kid = explainError(error);
    setStatus("error", `😕 ${kid.title}`, kid.steps);
    sendBtn.textContent = "Try again";
    if (error instanceof DeviceError) {
      if (error.code === "firmware-update-required") {
        // Forget the stale device so retrying shows the picker again rather
        // than silently re-grabbing the board that just failed.
        try {
          await usb.clearDevice();
        } catch {
          // Best effort — the reset below recreates the connection anyway.
        }
      }
      // A fresh connection clears stale DAPLink/WebUSB state, which is the
      // usual cure for repeated flash failures.
      await resetConnection();
    }
  } finally {
    pickerHelp.style.display = "none";
    busy = false;
    sendBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Simulator (the micro:bit Foundation's hosted one, same as python.microbit.org)
// ---------------------------------------------------------------------------
function postToSimulator(message: object) {
  simulatorFrame.contentWindow?.postMessage(message, SIMULATOR_ORIGIN);
}

async function runInSimulator() {
  if (!simulatorReady) {
    logOutput("page", "❌ Simulator not ready yet");
    return;
  }
  if (!targetFilename) {
    logOutput("page", "❌ This page was opened with a bad file name in the link. Tell your teacher.");
    return;
  }
  try {
    const code = await fetchStudentFile(targetFilename);
    if (!code.trim()) {
      logOutput("page", `❌ ${targetFilename} is empty — write some code first!`);
      return;
    }
    postToSimulator({
      kind: "flash",
      filesystem: { "main.py": new TextEncoder().encode(code) },
    });
  } catch {
    logOutput("page", `❌ Couldn't load ${targetFilename}. Check that it exists, then reload this page.`);
  }
}

function stopSimulator() {
  if (!simulatorReady) return;
  postToSimulator({ kind: "stop" });
}

function resetSimulator() {
  if (!simulatorReady) return;
  postToSimulator({ kind: "reset" });
  logOutput("page", "Simulator reset");
}

window.addEventListener("message", (event) => {
  if (event.origin !== SIMULATOR_ORIGIN) return;
  const message = event.data;
  switch (message.kind) {
    case "ready":
      simulatorReady = true;
      updateSimulatorUI();
      logOutput("page", "✓ Simulator ready");
      break;
    case "request_flash":
      // Kid clicked the play button inside the simulator itself.
      void runInSimulator();
      break;
    case "serial_output":
      logOutput("sim", message.data);
      break;
    case "state_change":
      if (message.data === "running") {
        logOutput("sim", "▶ Running…");
      } else if (message.data === "stopped") {
        logOutput("sim", "⏹ Stopped");
      }
      break;
    case "internal_error":
      logOutput("sim", `❌ Simulator error: ${message.data}`);
      break;
    case "radio_output":
      logOutput("sim", `[Radio] ${message.data}`);
      break;
  }
});

function updateSimulatorUI() {
  runBtn.disabled = !simulatorReady;
  stopBtn.disabled = !simulatorReady;
  resetBtn.disabled = !simulatorReady;
  if (simulatorReady) {
    simStatus.textContent = "✓ Simulator Ready";
    simStatus.className = "chip ready";
  } else {
    simStatus.textContent = "Loading Simulator…";
    simStatus.className = "chip loading";
  }
}

// ---------------------------------------------------------------------------
// Auto-run on tab focus: opt-in, so switching back from Codio re-runs the
// simulator with the latest code. Never auto-flashes the real device.
// ---------------------------------------------------------------------------
function setUpAutoRun() {
  autoRunCheckbox.checked = localStorage.getItem(AUTORUN_STORAGE_KEY) === "on";
  autoRunCheckbox.addEventListener("change", () => {
    localStorage.setItem(AUTORUN_STORAGE_KEY, autoRunCheckbox.checked ? "on" : "off");
  });
  window.addEventListener("focus", () => {
    const now = Date.now();
    if (autoRunCheckbox.checked && simulatorReady && now - lastAutoRunAt > 1000) {
      lastAutoRunAt = now;
      void runInSimulator();
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  versionSpan.textContent = __TOOLS_VERSION__;
  const shownName = targetFilename ?? "(invalid file name)";
  filenameSpan.textContent = shownName;
  runBtn.textContent = `▶ Run ${targetFilename ?? ""}`.trim();

  setUpAutoRun();
  runBtn.addEventListener("click", () => void runInSimulator());
  stopBtn.addEventListener("click", stopSimulator);
  resetBtn.addEventListener("click", resetSimulator);
  setTimeout(() => {
    if (!simulatorReady) {
      simStatus.textContent = "⚠ Simulator Load Timeout";
      simStatus.className = "chip error";
      logOutput("page", "❌ Simulator failed to load. Check your internet connection, then reload this page.");
    }
  }, 15000);

  const env = checkEnvironment();
  if (env === "unsupported") {
    flashUnsupported.style.display = "block";
    hexDownloadBtn2.addEventListener("click", () => void downloadHex());
  } else if (env === "framed") {
    flashFramed.style.display = "block";
    popoutLink.href = window.location.href;
  } else {
    flashLive.style.display = "block";
    usb = createConnection();
    await usb.initialize();
    sendBtn.addEventListener("click", () => void send());
    hexDownloadLink.addEventListener("click", (e) => {
      e.preventDefault();
      void downloadHex();
    });
    setStatus("info", "Plug in your micro:bit with a USB cable, then click the button.");
    // Warm the firmware cache while the kid reads the page.
    void getFilesystem().catch(() => {});
  }
}

void init();
