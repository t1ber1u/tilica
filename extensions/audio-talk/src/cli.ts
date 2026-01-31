import type { Command } from "commander";
import type { AudioTalkConfig } from "./config.js";
import { runTalkLoop } from "./loop.js";
import { checkDependencies } from "./deps.js";
import type { TalkLoopOptions } from "./types.js";

export interface CliContext {
  program: Command;
  config: AudioTalkConfig;
  logger: { debug: (...args: unknown[]) => void; info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export function registerAudioTalkCli({ program, config, logger }: CliContext) {
  program
    .command("talk")
    .description("Start a voice conversation loop using local whisper.cpp STT")
    .option("--fixture <path>", "Use pre-recorded WAV file instead of microphone")
    .option("--model <path>", "Whisper model path override")
    .option("--lang <code>", "Language code (default: ro)", config.whisper.language)
    .option("--tts", "Enable text-to-speech for responses")
    .option("--no-tts", "Disable text-to-speech for responses")
    .option("--voice <name>", "TTS voice name (macOS)")
    .option("--agent <id>", "Agent ID to use")
    .option("--session <key>", "Session key to continue conversation")
    .option("--one-shot", "Single turn only, then exit")
    .option("--thinking <level>", "Thinking level (off, low, medium, high)", config.session.thinking)
    .option("--verbose", "Show debug output")
    .action(async (opts: {
      fixture?: string;
      model?: string;
      lang?: string;
      tts?: boolean;
      voice?: string;
      agent?: string;
      session?: string;
      oneShot?: boolean;
      thinking?: string;
      verbose?: boolean;
    }) => {
      try {
        // Check dependencies first
        const depsOk = await checkDependencies({
          ffmpegPath: config.audio.ffmpegPath,
          whisperPath: config.whisper.binaryPath,
          modelPath: opts.model || config.whisper.modelPath,
          skipFfmpeg: Boolean(opts.fixture), // Don't need ffmpeg in fixture mode
          logger,
        });

        if (!depsOk) {
          process.exit(1);
        }

        // Determine TTS setting: --tts enables, --no-tts disables, otherwise use config
        const ttsEnabled = opts.tts === true ? true : opts.tts === false ? false : config.tts.enabled;

        const loopOpts: TalkLoopOptions = {
          fixture: opts.fixture,
          modelPath: opts.model || config.whisper.modelPath,
          language: opts.lang || config.whisper.language,
          tts: ttsEnabled,
          ttsVoice: opts.voice || config.tts.voice,
          agentId: opts.agent || config.session.agentId,
          sessionKey: opts.session,
          oneShot: opts.oneShot,
          thinking: opts.thinking || config.session.thinking,
          verbose: opts.verbose,
        };

        // Set up abort handling
        const abortController = new AbortController();
        let exitRequested = false;

        process.on("SIGINT", () => {
          if (exitRequested) {
            console.log("\nForce exit.");
            process.exit(130);
          }
          exitRequested = true;
          console.log("\nExiting... (press Ctrl+C again to force)");
          abortController.abort();
        });

        const result = await runTalkLoop({
          ...loopOpts,
          config,
          logger,
          abortSignal: abortController.signal,
        });

        if (result.error) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }

        console.log(`\nConversation ended. ${result.turns} turn${result.turns !== 1 ? "s" : ""} completed.`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
