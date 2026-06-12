/**
 * Browser-based micro:bit simulator page for Codio assignments.
 *
 * Embeds the micro:bit Foundation's hosted Python simulator (the same one
 * used by python.microbit.org) and posts the student's code into it.
 */

import { fetchStudentFile, getTargetFilename } from "../shared/student-file";

declare const __TOOLS_VERSION__: string;

const SIMULATOR_ORIGIN = "https://python-simulator.usermbit.org";

const el = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const runBtn = el<HTMLButtonElement>("runBtn");
const stopBtn = el<HTMLButtonElement>("stopBtn");
const resetBtn = el<HTMLButtonElement>("resetBtn");
const statusSpan = el<HTMLSpanElement>("status");
const output = el<HTMLPreElement>("output");
const simulatorFrame = el<HTMLIFrameElement>("simulator");
const versionSpan = el<HTMLSpanElement>("version");

const targetFilename = getTargetFilename();
let simulatorReady = false;

function logOutput(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  output.textContent += `[${timestamp}] ${message}\n`;
  output.scrollTop = output.scrollHeight;
}

function post(message: object) {
  simulatorFrame.contentWindow?.postMessage(message, SIMULATOR_ORIGIN);
}

async function runCode() {
  if (!simulatorReady) {
    logOutput("❌ Simulator not ready yet");
    return;
  }
  if (!targetFilename) {
    logOutput("❌ This page was opened with a bad file name in the link. Tell your teacher.");
    return;
  }
  try {
    logOutput(`Loading ${targetFilename}…`);
    const code = await fetchStudentFile(targetFilename);
    if (!code.trim()) {
      logOutput(`❌ ${targetFilename} is empty — write some code first!`);
      return;
    }
    post({
      kind: "flash",
      filesystem: { "main.py": new TextEncoder().encode(code) },
    });
  } catch {
    logOutput(`❌ Couldn't load ${targetFilename}. Check that it exists, then reload this page.`);
  }
}

function stopSimulator() {
  if (!simulatorReady) return;
  logOutput("Stopping…");
  post({ kind: "stop" });
}

function resetSimulator() {
  if (!simulatorReady) return;
  post({ kind: "reset" });
  output.textContent = "";
  logOutput("Simulator reset");
}

window.addEventListener("message", (event) => {
  if (event.origin !== SIMULATOR_ORIGIN) return;
  const message = event.data;
  switch (message.kind) {
    case "ready":
      simulatorReady = true;
      updateUI();
      logOutput("✓ Simulator ready");
      break;
    case "request_flash":
      // Kid clicked the play button inside the simulator itself.
      void runCode();
      break;
    case "serial_output":
      logOutput(`[micro:bit] ${message.data}`);
      break;
    case "state_change":
      if (message.data === "running") {
        logOutput("▶ Running…");
      } else if (message.data === "stopped") {
        logOutput("⏹ Stopped");
      }
      break;
    case "internal_error":
      logOutput(`❌ Simulator error: ${message.data}`);
      break;
    case "radio_output":
      logOutput(`[Radio] ${message.data}`);
      break;
  }
});

function updateUI() {
  runBtn.disabled = !simulatorReady;
  stopBtn.disabled = !simulatorReady;
  resetBtn.disabled = !simulatorReady;
  if (simulatorReady) {
    statusSpan.textContent = "✓ Simulator Ready";
    statusSpan.className = "status ready";
  } else {
    statusSpan.textContent = "Loading Simulator…";
    statusSpan.className = "status loading";
  }
}

function init() {
  versionSpan.textContent = __TOOLS_VERSION__;
  const shownName = targetFilename ?? "main.py";
  runBtn.textContent = `▶ Run ${shownName}`;
  el<HTMLDivElement>("info").innerHTML =
    `Edit <strong>${shownName}</strong> in Codio's editor, then click “Run ${shownName}” to test it here.`;

  runBtn.addEventListener("click", () => void runCode());
  stopBtn.addEventListener("click", stopSimulator);
  resetBtn.addEventListener("click", resetSimulator);

  updateUI();
  logOutput("Waiting for simulator to load…");
  setTimeout(() => {
    if (!simulatorReady) {
      statusSpan.textContent = "⚠ Simulator Load Timeout";
      statusSpan.className = "status error";
      logOutput("❌ Simulator failed to load. Check your internet connection, then reload this page.");
    }
  }, 15000);
}

init();
