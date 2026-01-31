import { z } from "zod";

export const WhisperConfigSchema = z.object({
  /** Path to whisper.cpp binary (auto-detect if empty) */
  binaryPath: z.string().default(""),
  /** Path to GGML model file (auto-detect if empty) */
  modelPath: z.string().default(""),
  /** Language code for transcription (default: ro for Romanian) */
  language: z.string().default("ro"),
  /** Number of CPU threads for transcription */
  threads: z.number().int().min(1).default(4),
}).default({});

export const AudioConfigSchema = z.object({
  /** Path to ffmpeg binary */
  ffmpegPath: z.string().default("ffmpeg"),
  /** avfoundation audio device (e.g., ":default", ":0") */
  device: z.string().default(":default"),
  /** Sample rate in Hz (16000 required for whisper) */
  sampleRate: z.number().int().min(8000).default(16000),
  /** Max recording duration in seconds */
  maxDurationSec: z.number().int().min(1).default(30),
}).default({});

export const TtsConfigSchema = z.object({
  /** Enable text-to-speech for responses */
  enabled: z.boolean().default(false),
  /** TTS engine (currently only macOS say supported) */
  engine: z.enum(["say"]).default("say"),
  /** macOS voice name (e.g., "Samantha", "Alex") */
  voice: z.string().optional(),
}).default({});

export const SessionConfigSchema = z.object({
  /** Default agent ID for conversations */
  agentId: z.string().optional(),
  /** Default thinking level (off, low, medium, high) */
  thinking: z.string().default("low"),
}).default({});

export const AudioTalkConfigSchema = z.object({
  /** Enable the audio-talk plugin */
  enabled: z.boolean().default(true),
  /** Whisper STT configuration */
  whisper: WhisperConfigSchema,
  /** Audio recording configuration */
  audio: AudioConfigSchema,
  /** Text-to-speech configuration */
  tts: TtsConfigSchema,
  /** Session/agent configuration */
  session: SessionConfigSchema,
}).default({});

export type WhisperConfig = z.infer<typeof WhisperConfigSchema>;
export type AudioConfig = z.infer<typeof AudioConfigSchema>;
export type TtsConfig = z.infer<typeof TtsConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type AudioTalkConfig = z.infer<typeof AudioTalkConfigSchema>;

/**
 * Apply environment variable overrides to config
 */
export function applyEnvOverrides(config: AudioTalkConfig): AudioTalkConfig {
  const whisperBin = process.env.CLAWBOT_WHISPER_BIN;
  const whisperModel = process.env.CLAWBOT_WHISPER_MODEL;
  const whisperLang = process.env.CLAWBOT_WHISPER_LANG;
  const ttsEnabled = process.env.CLAWBOT_TTS_ENABLED;
  const ttsVoice = process.env.CLAWBOT_TTS_VOICE;

  return {
    ...config,
    whisper: {
      ...config.whisper,
      binaryPath: whisperBin || config.whisper.binaryPath,
      modelPath: whisperModel || config.whisper.modelPath,
      language: whisperLang || config.whisper.language,
    },
    tts: {
      ...config.tts,
      enabled: ttsEnabled !== undefined ? ttsEnabled === "true" || ttsEnabled === "1" : config.tts.enabled,
      voice: ttsVoice || config.tts.voice,
    },
  };
}

/**
 * Create plugin config schema for registration
 */
export const audioTalkConfigSchema = {
  parse(value: unknown): AudioTalkConfig {
    const raw = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
    const parsed = AudioTalkConfigSchema.parse(raw);
    return applyEnvOverrides(parsed);
  },
  uiHints: {
    "whisper.binaryPath": { label: "Whisper Binary Path", placeholder: "whisper-cpp" },
    "whisper.modelPath": { label: "Whisper Model Path", placeholder: "~/.cache/clawdbot/models/whisper/ggml-base.bin" },
    "whisper.language": { label: "Language", placeholder: "ro" },
    "tts.enabled": { label: "Enable TTS" },
    "tts.voice": { label: "TTS Voice", placeholder: "Samantha" },
  },
};
