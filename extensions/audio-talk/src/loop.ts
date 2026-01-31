import { copyFile } from "node:fs/promises";
import type { AudioTalkConfig } from "./config.js";
import { resolveWhisperPaths, resolvePath } from "./deps.js";
import { recordAudio, generateTempPath, cleanupRecording } from "./recorder.js";
import { transcribe, createTranscriber } from "./transcriber.js";
import { speak, createSpeaker } from "./speaker.js";
import type { TalkLoopOptions, TalkLoopResult, TalkTurn } from "./types.js";

// Import agentCommand dynamically to avoid circular dependencies
// The extension runs in the same process as the CLI, so this should resolve
type AgentCommandOpts = {
  message: string;
  sessionKey?: string;
  agentId?: string;
  thinking?: string;
  deliver?: boolean;
  timeout?: string;
};

type AgentCommandResult = {
  payloads?: Array<{
    text?: string;
    mediaUrl?: string;
    isError?: boolean;
  }>;
  meta?: {
    durationMs?: number;
  };
};

type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

interface LoopContext {
  config: AudioTalkConfig;
  logger: Logger;
  whisperBinaryPath: string;
  whisperModelPath: string;
  language: string;
  ttsEnabled: boolean;
  ttsVoice?: string;
  sessionKey: string;
  agentId?: string;
  thinking: string;
  oneShot: boolean;
  verbose: boolean;
  abortSignal?: AbortSignal;
}

/**
 * Load the agentCommand function dynamically
 */
async function loadAgentCommand(): Promise<(opts: AgentCommandOpts) => Promise<AgentCommandResult>> {
  // Try to import from the main clawdbot package
  // This works because extensions run in the same process
  try {
    const mod = await import("../../../src/commands/agent.js");
    return mod.agentCommand;
  } catch {
    throw new Error(
      "Failed to import agentCommand. Make sure you're running from within the clawdbot workspace.",
    );
  }
}

/**
 * Send a message to the agent and get the response
 */
async function sendToAgent(
  agentCommand: (opts: AgentCommandOpts) => Promise<AgentCommandResult>,
  message: string,
  ctx: LoopContext,
): Promise<{ text: string; durationMs: number }> {
  const startTime = Date.now();

  const result = await agentCommand({
    message,
    sessionKey: ctx.sessionKey,
    agentId: ctx.agentId,
    thinking: ctx.thinking,
    deliver: false, // Don't send to external channels
  });

  const responseText = result?.payloads?.[0]?.text ?? "";
  const durationMs = Date.now() - startTime;

  return { text: responseText, durationMs };
}

/**
 * Run a single conversation turn
 */
async function runTurn(
  ctx: LoopContext,
  fixturePath: string | undefined,
  agentCommand: (opts: AgentCommandOpts) => Promise<AgentCommandResult>,
): Promise<{ success: boolean; turn?: TalkTurn; error?: string; aborted?: boolean }> {
  let audioPath: string;
  let shouldCleanup = true;

  // Step 1: Get audio (record or use fixture)
  if (fixturePath) {
    // Copy fixture to temp path so we don't modify the original
    audioPath = generateTempPath();
    try {
      await copyFile(resolvePath(fixturePath), audioPath);
      ctx.logger.debug(`[audio-talk] Using fixture: ${fixturePath}`);
    } catch (err) {
      return {
        success: false,
        error: `Failed to read fixture: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else {
    // Record from microphone
    console.log("\n🎤 Listening... (press Enter to stop)");

    const recordResult = await recordAudio({
      ffmpegPath: ctx.config.audio.ffmpegPath || "ffmpeg",
      device: ctx.config.audio.device || ":default",
      sampleRate: ctx.config.audio.sampleRate || 16000,
      maxDurationSec: ctx.config.audio.maxDurationSec || 30,
      outputPath: generateTempPath(),
      abortSignal: ctx.abortSignal,
    });

    if (!recordResult.success) {
      if (recordResult.error === "Recording aborted") {
        return { success: false, aborted: true };
      }
      return { success: false, error: recordResult.error };
    }

    audioPath = recordResult.outputPath;
    ctx.logger.debug(`[audio-talk] Recorded ${recordResult.durationMs}ms to ${audioPath}`);
  }

  try {
    // Step 2: Transcribe
    console.log("📝 Transcribing...");

    const transcribeResult = await transcribe({
      binaryPath: ctx.whisperBinaryPath,
      modelPath: ctx.whisperModelPath,
      language: ctx.language,
      threads: ctx.config.whisper.threads,
      inputPath: audioPath,
      abortSignal: ctx.abortSignal,
    });

    if (!transcribeResult.success) {
      if (transcribeResult.error === "Transcription aborted") {
        return { success: false, aborted: true };
      }
      return { success: false, error: transcribeResult.error };
    }

    const userText = transcribeResult.text.trim();

    if (!userText) {
      console.log("❓ No speech detected. Try again.");
      return { success: true }; // Continue loop without a turn
    }

    console.log(`\n👤 You: ${userText}`);
    ctx.logger.debug(`[audio-talk] Transcribed in ${transcribeResult.durationMs}ms`);

    // Step 3: Send to agent
    console.log("🤔 Thinking...");

    const agentResult = await sendToAgent(agentCommand, userText, ctx);

    if (!agentResult.text) {
      console.log("⚠️  No response from agent.");
      return { success: true }; // Continue loop
    }

    console.log(`\n🤖 Clawdbot: ${agentResult.text}`);
    ctx.logger.debug(`[audio-talk] Agent responded in ${agentResult.durationMs}ms`);

    // Step 4: TTS (optional)
    if (ctx.ttsEnabled && agentResult.text) {
      console.log("🔊 Speaking...");

      const speakResult = await speak({
        text: agentResult.text,
        voice: ctx.ttsVoice,
        abortSignal: ctx.abortSignal,
      });

      if (!speakResult.success && speakResult.error) {
        ctx.logger.warn(`[audio-talk] TTS failed: ${speakResult.error}`);
      }
    }

    return {
      success: true,
      turn: {
        userText,
        assistantText: agentResult.text,
        transcriptionMs: transcribeResult.durationMs,
        responseMs: agentResult.durationMs,
      },
    };
  } finally {
    // Cleanup temp audio file
    if (shouldCleanup) {
      await cleanupRecording(audioPath);
    }
  }
}

/**
 * Run the voice conversation loop
 */
export async function runTalkLoop(
  opts: TalkLoopOptions & {
    config: AudioTalkConfig;
    logger: Logger;
  },
): Promise<TalkLoopResult> {
  const { config, logger, fixture, abortSignal } = opts;

  // Resolve whisper paths
  const { binaryPath, modelPath } = await resolveWhisperPaths(
    config.whisper.binaryPath,
    opts.modelPath || config.whisper.modelPath,
  );

  if (!binaryPath || !modelPath) {
    return {
      turns: 0,
      aborted: false,
      error: "Whisper binary or model not found. Run 'clawdbot talk' with --verbose for setup instructions.",
    };
  }

  // Load agentCommand
  let agentCommand: (opts: AgentCommandOpts) => Promise<AgentCommandResult>;
  try {
    agentCommand = await loadAgentCommand();
  } catch (err) {
    return {
      turns: 0,
      aborted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Build context
  const ctx: LoopContext = {
    config,
    logger,
    whisperBinaryPath: binaryPath,
    whisperModelPath: modelPath,
    language: opts.language || config.whisper.language,
    ttsEnabled: opts.tts ?? config.tts.enabled,
    ttsVoice: opts.ttsVoice || config.tts.voice,
    sessionKey: opts.sessionKey || `talk/${Date.now()}`,
    agentId: opts.agentId || config.session.agentId,
    thinking: opts.thinking || config.session.thinking,
    oneShot: opts.oneShot ?? false,
    verbose: opts.verbose ?? false,
    abortSignal,
  };

  // Print welcome
  console.log("\n🎙️  Voice conversation started");
  console.log(`   Language: ${ctx.language}`);
  console.log(`   TTS: ${ctx.ttsEnabled ? "enabled" : "disabled"}`);
  console.log(`   Session: ${ctx.sessionKey}`);
  if (fixture) {
    console.log(`   Mode: fixture (${fixture})`);
  } else {
    console.log("   Press Enter to stop recording, Ctrl+C to exit");
  }
  console.log("");

  const turns: TalkTurn[] = [];
  let aborted = false;

  // Main loop
  while (true) {
    // Check abort signal
    if (abortSignal?.aborted) {
      aborted = true;
      break;
    }

    const result = await runTurn(ctx, fixture, agentCommand);

    if (result.aborted) {
      aborted = true;
      break;
    }

    if (!result.success) {
      return {
        turns: turns.length,
        aborted: false,
        error: result.error,
      };
    }

    if (result.turn) {
      turns.push(result.turn);
    }

    // Exit after one turn in one-shot or fixture mode
    if (ctx.oneShot || fixture) {
      break;
    }
  }

  return {
    turns: turns.length,
    aborted,
  };
}
