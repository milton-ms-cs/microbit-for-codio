/**
 * Loads the MicroPython firmware hex that sits next to the tool pages.
 *
 * The filename is versioned (e.g. micropython-microbit-v2.1.1.hex), so a
 * cached copy can be kept forever: a firmware upgrade changes the filename
 * and therefore the cache key. Cached via the Cache API so the 1.2 MB hex
 * is downloaded once per browser, not once per page load.
 */

import { FirmwareLoadError } from "./errors";

const CACHE_NAME = "microbit-tools-firmware";

export async function loadFirmware(filename: string): Promise<string> {
  const url = new URL(filename, window.location.href).toString();

  if ("caches" in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) {
        return await cached.text();
      }
      const response = await fetchFirmware(url);
      await cache.put(url, response.clone());
      return await response.text();
    } catch (error) {
      if (error instanceof FirmwareLoadError) {
        throw error;
      }
      // Cache API unavailable (insecure context, storage blocked) — plain fetch.
    }
  }
  return await (await fetchFirmware(url)).text();
}

async function fetchFirmware(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new FirmwareLoadError(`Network error fetching ${url}`);
  }
  if (!response.ok) {
    throw new FirmwareLoadError(`HTTP ${response.status} fetching ${url}`);
  }
  return response;
}
