import { spawn, type ChildProcess } from "node:child_process";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { RecorderOptions, RecorderResult } from "./types.js";

// Track the current recording process for cleanup
let currentRecordingProc: ChildProcess | null = null;

/**
 * Build ffmpeg command arguments for recording from macOS microphone
 */
export function buildFfmpegArgs(opts: RecorderOptions): string[] {
  return [
    "-f", "avfoundation",      // macOS audio/video framework
    "-i", opts.device,          // Audio device (e.g., ":default" or ":0")
    "-ac", "1",                 // Mono
    "-ar", String(opts.sampleRate),  // Sample rate (16000 for whisper)
    "-t", String(opts.maxDurationSec), // Max duration
    "-c:a", "pcm_s16le",        // 16-bit PCM (WAV)
    "-y",                       // Overwrite output
    opts.outputPath,
  ];
}

/**
 * Generate a unique temp file path for recording
 */
export function generateTempPath(): string {
  const filename = `clawdbot_rec_${randomUUID().slice(0, 8)}.wav`;
  return join(tmpdir(), filename);
}

/**
 * Record audio from microphone using ffmpeg
 *
 * Recording stops when:
 * 1. User presses Enter
 * 2. Max duration is reached
 * 3. AbortSignal is triggered
 * 4. Error occurs
 */
export async function recordAudio(opts: RecorderOptions): Promise<RecorderResult> {
  const startTime = Date.now();
  const args = buildFfmpegArgs(opts);

  return new Promise((resolve) => {
    let stoppedByUser = false;
    let killed = false;
    let stderr = "";

    const proc = spawn(opts.ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    currentRecordingProc = proc;

    // Set up readline for Enter key detection
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    const cleanup = () => {
      rl.close();
      currentRecordingProc = null;
    };

    // Stop on Enter key
    rl.once("line", () => {
      if (proc.exitCode === null) {
        stoppedByUser = true;
        proc.kill("SIGINT"); // Graceful stop
      }
    });

    // Handle abort signal
    if (opts.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => {
        killed = true;
        if (proc.exitCode === null) {
          proc.kill("SIGTERM");
        }
      });
    }

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      cleanup();
      resolve({
        success: false,
        outputPath: opts.outputPath,
        durationMs: Date.now() - startTime,
        error: `Failed to spawn ffmpeg: ${err.message}`,
      });
    });

    proc.on("close", (code) => {
      cleanup();
      const durationMs = Date.now() - startTime;

      if (killed) {
        resolve({
          success: false,
          outputPath: opts.outputPath,
          durationMs,
          error: "Recording aborted",
        });
        return;
      }

      // ffmpeg returns various codes, but if we stopped it gracefully (SIGINT), treat as success
      // Code 255 is common when ffmpeg is interrupted
      const isSuccess = code === 0 || code === 255 || stoppedByUser;

      if (!isSuccess) {
        resolve({
          success: false,
          outputPath: opts.outputPath,
          durationMs,
          error: `ffmpeg exited with code ${code}: ${stderr.slice(-500)}`,
        });
        return;
      }

      resolve({
        success: true,
        outputPath: opts.outputPath,
        durationMs,
        stoppedByUser,
      });
    });
  });
}

/**
 * Stop any current recording
 */
export function stopRecording(): void {
  if (currentRecordingProc && currentRecordingProc.exitCode === null) {
    currentRecordingProc.kill("SIGINT");
  }
}

/**
 * Delete a temp recording file
 */
export async function cleanupRecording(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Ignore errors (file may not exist)
  }
}

/**
 * Create a recorder function with pre-configured options
 */
export function createRecorder(baseOpts: Omit<RecorderOptions, "outputPath" | "abortSignal">) {
  return async (abortSignal?: AbortSignal): Promise<RecorderResult> => {
    const outputPath = generateTempPath();
    return recordAudio({
      ...baseOpts,
      outputPath,
      abortSignal,
    });
  };
}
