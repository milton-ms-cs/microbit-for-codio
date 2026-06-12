/**
 * Reading the student's Python file named by the ?file= URL parameter.
 *
 * The tool pages are served by Codio's workspace static server either from
 * the workspace root (legacy per-assignment copies) or from
 * workspace/microbit-tools/ (stack-installed copies). The student's .py files
 * always live in the workspace root, so we try the page's own directory first
 * and fall back to the parent directory. That way the same built page works
 * in both layouts with no configuration.
 */

export class StudentFileError extends Error {
  constructor(
    public filename: string,
    message: string,
  ) {
    super(message);
    this.name = "StudentFileError";
  }
}

const FILENAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.py$/;

/**
 * Returns the validated target filename from ?file=, or undefined if the
 * parameter is present but unsafe/invalid (callers should show an error
 * rather than silently flashing the wrong file).
 */
export function getTargetFilename(): string | undefined {
  const param = new URLSearchParams(window.location.search).get("file");
  if (param === null) {
    return "main.py";
  }
  if (!FILENAME_PATTERN.test(param) || param.includes("..")) {
    return undefined;
  }
  return param;
}

export async function fetchStudentFile(filename: string): Promise<string> {
  const candidates = [
    new URL(filename, window.location.href),
    new URL("../" + filename, window.location.href),
  ];
  for (const url of candidates) {
    try {
      // no-store: the student edits this file between runs, never serve stale
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (response.ok) {
        return await response.text();
      }
    } catch {
      // Network-level failure for this candidate; try the next one.
    }
  }
  throw new StudentFileError(
    filename,
    `Could not load ${filename} from the workspace`,
  );
}
