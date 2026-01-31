import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { resolvePath } from "./deps.js";
import type { TranscriberOptions, TranscriberResult } from "./types.js";

/**
 * Build command line arguments for whisper.cpp
 */
export function buildWhisperArgs(opts: TranscriberOptions): string[] {
  const args: string[] = [
    "-m", resolvePath(opts.modelPath),
    "-f", opts.inputPath,
    "-l", opts.language,
    "-t", String(opts.threads),
    "--no-timestamps",  // Clean output without timestamps
    "-otxt",            // Output as text
  ];
  return args;
}

/**
 * Parse whisper.cpp stdout/stderr output to extract transcript
 *
 * whisper.cpp outputs lines like:
 * [00:00:000 --> 00:02:500]  Hello world
 *
 * With --no-timestamps, it outputs plain text.
 * We strip any remaining timestamp patterns and clean up the text.
 */
export function parseWhisperOutput(output: string): string {
  // Remove timestamp patterns like [00:00:000 --> 00:02:500]
  const withoutTimestamps = output.replace(/\[\d{2}:\d{2}[:.]\d{3}\s*-->\s*\d{2}:\d{2}[:.]\d{3}\]\s*/g, "");

  // Remove whisper.cpp log lines (start with whisper_ or contain specific patterns)
  const lines = withoutTimestamps
    .split("\n")
    .filter(line => {
      const trimmed = line.trim();
      // Skip empty lines and common whisper.cpp log patterns
      if (!trimmed) return false;
      if (trimmed.startsWith("whisper_")) return false;
      if (trimmed.startsWith("main:")) return false;
      if (trimmed.includes("model:")) return false;
      if (trimmed.includes("system_info:")) return false;
      if (trimmed.includes("sampling:")) return false;
      if (trimmed.includes("output:")) return false;
      if (trimmed.match(/^\d+ threads?/)) return false;
      if (trimmed.match(/^processing/i)) return false;
      if (trimmed.match(/^loading model/i)) return false;
      return true;
    })
    .map(line => line.trim());

  return lines.join(" ").trim();
}

/**
 * Transcribe audio file using whisper.cpp
 */
export async function transcribe(opts: TranscriberOptions): Promise<TranscriberResult> {
  const startTime = Date.now();
  const binaryPath = resolvePath(opts.binaryPath);
  const args = buildWhisperArgs(opts);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const proc = spawn(binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (opts.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => {
        killed = true;
        proc.kill("SIGTERM");
      });
    }

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        text: "",
        durationMs: Date.now() - startTime,
        error: `Failed to spawn whisper: ${err.message}`,
      });
    });

    proc.on("close", async (code) => {
      const durationMs = Date.now() - startTime;

      if (killed) {
        resolve({
          success: false,
          text: "",
          durationMs,
          error: "Transcription aborted",
        });
        return;
      }

      if (code !== 0) {
        resolve({
          success: false,
          text: "",
          durationMs,
          error: `Whisper exited with code ${code}: ${stderr.slice(0, 500)}`,
        });
        return;
      }

      // whisper.cpp with -otxt writes output to {input}.txt
      const outputTxtPath = `${opts.inputPath}.txt`;
      try {
        const text = await readFile(outputTxtPath, "utf-8");
        // Clean up the output file
        await unlink(outputTxtPath).catch(() => {});

        resolve({
          success: true,
          text: text.trim(),
          durationMs,
        });
      } catch (err) {
        // Fall back to parsing stdout/stderr if file not found
        const combined = stdout + stderr;
        const text = parseWhisperOutput(combined);

        resolve({
          success: true,
          text,
          durationMs,
        });
      }
    });
  });
}

/**
 * Create a transcriber function with pre-configured options
 */
export function createTranscriber(baseOpts: Omit<TranscriberOptions, "inputPath" | "abortSignal">) {
  return async (inputPath: string, abortSignal?: AbortSignal): Promise<TranscriberResult> => {
    return transcribe({
      ...baseOpts,
      inputPath,
      abortSignal,
    });
  };
}
