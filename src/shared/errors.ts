/**
 * Maps technical failures to messages middle schoolers can act on.
 *
 * @microbit/microbit-connection throws DeviceError with a typed `code`
 * (see DeviceErrorCode in the library), which is what we match on first.
 */

import { DeviceError } from "@microbit/microbit-connection";
import { StudentFileError } from "./student-file";

export interface KidError {
  /** One-line summary in kid language. */
  title: string;
  /** Ordered things to try, shown as a list. */
  steps: string[];
  /** True when retrying without doing anything else is pointless. */
  needsTeacher?: boolean;
}

/** Thrown by our own flash data source when a V1 board is connected. */
export class UnsupportedBoardError extends Error {
  constructor() {
    super("micro:bit V1 is not supported by this firmware");
    this.name = "UnsupportedBoardError";
  }
}

/** Thrown when the firmware hex cannot be fetched. */
export class FirmwareLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirmwareLoadError";
  }
}

const UNPLUG_REPLUG = "Unplug the micro:bit, plug it back in, and wait for the yellow light to stop blinking";

export function explainError(error: unknown): KidError {
  if (error instanceof StudentFileError) {
    return {
      title: `Couldn't find your program file (${error.filename}).`,
      steps: [
        `Check that ${error.filename} still exists in the file tree`,
        "Reload this page and try again",
        "If it's still missing, tell your teacher",
      ],
    };
  }
  if (error instanceof FirmwareLoadError) {
    return {
      title: "Couldn't load the micro:bit software.",
      steps: [
        "Check that your internet connection is working",
        "Reload this page and try again",
      ],
    };
  }
  if (error instanceof UnsupportedBoardError) {
    return {
      title: "This micro:bit is an older model (V1).",
      steps: ["Tell your teacher — you need a newer micro:bit for this class"],
      needsTeacher: true,
    };
  }
  if (error instanceof DeviceError) {
    switch (error.code) {
      case "no-device-selected":
        return {
          title: "You didn't pick a micro:bit.",
          steps: [
            "Click the button again",
            "In the popup list, click “BBC micro:bit”",
            "Then click Connect",
          ],
        };
      case "device-in-use":
        return {
          title: "Another tab is already talking to your micro:bit.",
          steps: [
            "Close any other micro:bit tabs (MakeCode, python.microbit.org, another copy of this page)",
            UNPLUG_REPLUG,
            "Click the button again",
          ],
        };
      case "device-disconnected":
        return {
          title: "The micro:bit got disconnected.",
          steps: [
            "Check that the USB cable is pushed in all the way at both ends",
            UNPLUG_REPLUG,
            "Click the button again",
          ],
        };
      case "timeout":
      case "connection-error":
        return {
          title: "The micro:bit stopped responding.",
          steps: [
            UNPLUG_REPLUG,
            "Click the button again",
            "Still stuck? Try a different USB cable or a different USB port",
          ],
        };
      case "unsupported":
        return {
          title: "This browser can't talk to a micro:bit.",
          steps: ["Use Google Chrome or Microsoft Edge on a computer"],
          needsTeacher: true,
        };
      case "firmware-update-required":
        return {
          title: "This micro:bit needs a firmware update before it can be used here.",
          steps: ["Tell your teacher — the micro:bit itself needs updating"],
          needsTeacher: true,
        };
    }
  }
  const detail = error instanceof Error ? error.message : String(error);
  return {
    title: "Something went wrong sending your program.",
    steps: [
      UNPLUG_REPLUG,
      "Click the button again",
      `Still stuck? Tell your teacher and show them this: “${detail}”`,
    ],
  };
}
