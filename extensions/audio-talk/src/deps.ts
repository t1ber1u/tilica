import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CheckDependenciesOptions {
  ffmpegPath: string;
  whisperPath: string;
  modelPath: string;
  skipFfmpeg?: boolean;
  logger: { debug: (...args: unknown[]) => void; info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

/**
 * Resolve path with ~ expansion
 */
export function resolvePath(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

/**
 * Check if a command exists and is executable
 */
async function checkCommand(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("which", [cmd], { stdio: "pipe" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Check if a file exists and is readable
 */
async function checkFile(path: string): Promise<boolean> {
  try {
    await access(resolvePath(path), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to find whisper.cpp binary in common locations
 */
export async function findWhisperBinary(): Promise<string | null> {
  const candidates = [
    "whisper-cpp",
    "whisper",
    "/usr/local/bin/whisper",
    "/opt/homebrew/bin/whisper",
    join(homedir(), ".local/bin/whisper"),
    join(homedir(), "whisper.cpp/main"),
    join(homedir(), "whisper.cpp/build/bin/main"),
  ];

  for (const candidate of candidates) {
    if (await checkCommand(candidate) || await checkFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Try to find whisper model in common locations
 */
export async function findWhisperModel(): Promise<string | null> {
  const modelNames = ["ggml-base.bin", "ggml-small.bin", "ggml-tiny.bin", "ggml-medium.bin"];
  const baseDirs = [
    join(homedir(), ".cache/clawdbot/models/whisper"),
    join(homedir(), ".cache/whisper"),
    join(homedir(), "whisper.cpp/models"),
    "/usr/local/share/whisper/models",
  ];

  for (const dir of baseDirs) {
    for (const model of modelNames) {
      const path = join(dir, model);
      if (await checkFile(path)) {
        return path;
      }
    }
  }
  return null;
}

/**
 * Check all required dependencies and provide helpful error messages
 */
export async function checkDependencies(opts: CheckDependenciesOptions): Promise<boolean> {
  const { whisperPath, modelPath, skipFfmpeg, logger } = opts;
  // Default to "ffmpeg" if not specified
  const ffmpegPath = opts.ffmpegPath || "ffmpeg";
  let allOk = true;

  // Check ffmpeg (needed for mic recording)
  if (!skipFfmpeg) {
    const ffmpegOk = await checkCommand(ffmpegPath);
    if (!ffmpegOk) {
      logger.error(`[audio-talk] ffmpeg not found at "${ffmpegPath}"`);
      logger.error("  Install with: brew install ffmpeg");
      allOk = false;
    } else {
      logger.debug(`[audio-talk] ffmpeg found: ${ffmpegPath}`);
    }
  }

  // Check whisper binary
  let resolvedWhisperPath = whisperPath;
  if (!resolvedWhisperPath) {
    resolvedWhisperPath = await findWhisperBinary() || "";
  }

  if (!resolvedWhisperPath) {
    logger.error("[audio-talk] whisper.cpp binary not found");
    logger.error("  Build from source:");
    logger.error("    git clone https://github.com/ggml-org/whisper.cpp");
    logger.error("    cd whisper.cpp && make -j");
    logger.error("  Then set config: whisper.binaryPath = /path/to/whisper.cpp/main");
    allOk = false;
  } else {
    const whisperOk = await checkCommand(resolvedWhisperPath) || await checkFile(resolvedWhisperPath);
    if (!whisperOk) {
      logger.error(`[audio-talk] whisper binary not found at "${resolvedWhisperPath}"`);
      allOk = false;
    } else {
      logger.debug(`[audio-talk] whisper found: ${resolvedWhisperPath}`);
    }
  }

  // Check whisper model
  let resolvedModelPath = modelPath;
  if (!resolvedModelPath) {
    resolvedModelPath = await findWhisperModel() || "";
  }

  if (!resolvedModelPath) {
    logger.error("[audio-talk] whisper model not found");
    logger.error("  Download a multilingual model (NOT .en variants for non-English):");
    logger.error("    cd whisper.cpp");
    logger.error("    bash models/download-ggml-model.sh base");
    logger.error("    mkdir -p ~/.cache/clawdbot/models/whisper");
    logger.error("    cp models/ggml-base.bin ~/.cache/clawdbot/models/whisper/");
    logger.error("  Then set config: whisper.modelPath = ~/.cache/clawdbot/models/whisper/ggml-base.bin");
    allOk = false;
  } else {
    const modelOk = await checkFile(resolvedModelPath);
    if (!modelOk) {
      logger.error(`[audio-talk] whisper model not found at "${resolvedModelPath}"`);
      allOk = false;
    } else {
      logger.debug(`[audio-talk] whisper model found: ${resolvedModelPath}`);
    }
  }

  // Check macOS say command (for TTS)
  const sayOk = await checkCommand("say");
  if (!sayOk) {
    logger.warn("[audio-talk] macOS 'say' command not found - TTS will not work");
  } else {
    logger.debug("[audio-talk] say command found");
  }

  return allOk;
}

/**
 * Get resolved paths for whisper binary and model, using auto-detection if needed
 */
export async function resolveWhisperPaths(whisperPath: string, modelPath: string): Promise<{ binaryPath: string; modelPath: string }> {
  const binaryPath = whisperPath || await findWhisperBinary() || "";
  const resolvedModelPath = modelPath || await findWhisperModel() || "";
  return { binaryPath, modelPath: resolvedModelPath };
}
