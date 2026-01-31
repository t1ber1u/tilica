import { spawn } from "node:child_process";
import type { SpeakerOptions, SpeakerResult } from "./types.js";

/**
 * Escape text for safe use with macOS `say` command
 *
 * The say command can handle most text directly, but we need to be careful
 * with shell special characters when spawning.
 */
export function escapeTextForSay(text: string): string {
  // Remove or replace problematic characters
  // The spawn function handles most escaping, but we clean up the text
  return text
    .replace(/[\x00-\x1f]/g, " ")  // Remove control characters
    .trim();
}

/**
 * Build command line arguments for macOS `say` command
 */
export function buildSayArgs(opts: SpeakerOptions): string[] {
  const args: string[] = [];

  if (opts.voice) {
    args.push("-v", opts.voice);
  }

  // Pass text directly as argument (spawn handles escaping)
  args.push(escapeTextForSay(opts.text));

  return args;
}

/**
 * Speak text using macOS `say` command
 */
export async function speak(opts: SpeakerOptions): Promise<SpeakerResult> {
  const args = buildSayArgs(opts);

  return new Promise((resolve) => {
    let killed = false;
    let stderr = "";

    const proc = spawn("say", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    if (opts.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => {
        killed = true;
        proc.kill("SIGTERM");
      });
    }

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        error: `Failed to spawn say: ${err.message}`,
      });
    });

    proc.on("close", (code) => {
      if (killed) {
        resolve({
          success: true, // Consider abort as success (graceful stop)
        });
        return;
      }

      if (code !== 0) {
        resolve({
          success: false,
          error: `say exited with code ${code}: ${stderr.slice(0, 200)}`,
        });
        return;
      }

      resolve({ success: true });
    });
  });
}

/**
 * Stop any currently playing speech
 */
export function stopSpeaking(): void {
  // Kill any running `say` processes
  spawn("pkill", ["-f", "^say"], { stdio: "ignore" });
}

/**
 * List available macOS voices
 */
export async function listVoices(): Promise<string[]> {
  return new Promise((resolve) => {
    let stdout = "";

    const proc = spawn("say", ["-v", "?"], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("close", () => {
      // Parse voice list: "Samantha         en_US    # Samantha is a compact..."
      const voices = stdout
        .split("\n")
        .filter(line => line.trim())
        .map(line => line.split(/\s+/)[0])
        .filter(Boolean);

      resolve(voices);
    });

    proc.on("error", () => {
      resolve([]);
    });
  });
}

/**
 * Create a speaker function with pre-configured options
 */
export function createSpeaker(voice?: string) {
  return async (text: string, abortSignal?: AbortSignal): Promise<SpeakerResult> => {
    return speak({ text, voice, abortSignal });
  };
}
