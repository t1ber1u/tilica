export interface RecorderOptions {
  /** ffmpeg binary path */
  ffmpegPath: string;
  /** avfoundation device (e.g., ":default", ":0") */
  device: string;
  /** Sample rate in Hz (default: 16000) */
  sampleRate: number;
  /** Max recording duration in seconds */
  maxDurationSec: number;
  /** Output file path */
  outputPath: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

export interface RecorderResult {
  success: boolean;
  outputPath: string;
  durationMs: number;
  error?: string;
  /** True if recording was stopped by user (Enter key) */
  stoppedByUser?: boolean;
}

export interface TranscriberOptions {
  /** whisper.cpp binary path */
  binaryPath: string;
  /** Path to GGML model file */
  modelPath: string;
  /** Language code (e.g., "ro", "en", "auto") */
  language: string;
  /** Number of threads */
  threads: number;
  /** Input WAV file path */
  inputPath: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

export interface TranscriberResult {
  success: boolean;
  text: string;
  /** Detected language (if using auto-detect) */
  detectedLanguage?: string;
  /** Duration of transcription in ms */
  durationMs: number;
  error?: string;
}

export interface SpeakerOptions {
  /** Text to speak */
  text: string;
  /** macOS voice name (e.g., "Samantha", "Alex") */
  voice?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

export interface SpeakerResult {
  success: boolean;
  error?: string;
}

export interface TalkLoopOptions {
  /** Path to pre-recorded WAV file (skips mic recording) */
  fixture?: string;
  /** Session key for conversation continuity */
  sessionKey?: string;
  /** Agent ID override */
  agentId?: string;
  /** Thinking level (off, low, medium, high) */
  thinking?: string;
  /** Enable TTS response */
  tts?: boolean;
  /** TTS voice name */
  ttsVoice?: string;
  /** Single turn only */
  oneShot?: boolean;
  /** Language code for transcription */
  language?: string;
  /** Whisper model path override */
  modelPath?: string;
  /** Verbose debug output */
  verbose?: boolean;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

export interface TalkLoopResult {
  /** Number of conversation turns completed */
  turns: number;
  /** True if loop was aborted by user */
  aborted: boolean;
  /** Error message if loop failed */
  error?: string;
}

export interface TalkTurn {
  /** User's spoken text */
  userText: string;
  /** Assistant's response */
  assistantText: string;
  /** Transcription duration in ms */
  transcriptionMs: number;
  /** Agent response duration in ms */
  responseMs: number;
}
