import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

export type VoiceRecorderState = "idle" | "recording" | "processing" | "error";

/**
 * Voice recorder component with waveform visualization
 */
@customElement("voice-recorder")
export class VoiceRecorder extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .mic-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 14px;
    }

    .mic-btn--idle {
      background: var(--accent-color, #007aff);
      color: white;
    }

    .mic-btn--idle:hover {
      background: var(--accent-hover, #0066cc);
    }

    .mic-btn--recording {
      background: #ff3b30;
      color: white;
      animation: pulse 1s infinite;
    }

    .mic-btn--processing {
      background: #888;
      color: white;
      cursor: wait;
    }

    .mic-btn--error {
      background: #ff9500;
      color: white;
    }

    .mic-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    @keyframes pulse {
      0%,
      100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.1);
      }
    }

    .waveform {
      display: flex;
      align-items: center;
      gap: 2px;
      height: 24px;
      padding: 0 8px;
      background: rgba(255, 59, 48, 0.1);
      border-radius: 12px;
    }

    .waveform-bar {
      width: 3px;
      background: #ff3b30;
      border-radius: 2px;
      transition: height 0.1s ease;
    }

    .recording-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stop-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      background: #ff3b30;
      color: white;
      cursor: pointer;
      font-size: 12px;
    }

    .cancel-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: #888;
      cursor: pointer;
      font-size: 12px;
    }

    .cancel-btn:hover {
      background: rgba(0, 0, 0, 0.1);
    }

    .transcript-preview {
      font-size: 12px;
      color: #666;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .error-msg {
      font-size: 11px;
      color: #ff9500;
    }
  `;

  @property({ type: Boolean }) disabled = false;
  @property({ type: String }) language = "ro-RO";

  @state() private _state: VoiceRecorderState = "idle";
  @state() private _audioLevels: number[] = [0.2, 0.3, 0.2, 0.4, 0.2];
  @state() private _transcript = "";
  @state() private _error = "";

  private _mediaRecorder: MediaRecorder | null = null;
  private _audioChunks: Blob[] = [];
  private _analyser: AnalyserNode | null = null;
  private _animationFrame: number | null = null;
  private _recognition: SpeechRecognition | null = null;

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cleanup();
  }

  private _cleanup() {
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }
    if (this._mediaRecorder && this._mediaRecorder.state !== "inactive") {
      this._mediaRecorder.stop();
    }
    if (this._recognition) {
      this._recognition.stop();
    }
    this._mediaRecorder = null;
    this._analyser = null;
    this._recognition = null;
    this._audioChunks = [];
  }

  async startRecording() {
    if (this._state !== "idle") return;

    try {
      this._state = "recording";
      this._transcript = "";
      this._error = "";
      this._audioChunks = [];

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up audio analysis for waveform
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      this._analyser = audioContext.createAnalyser();
      this._analyser.fftSize = 32;
      source.connect(this._analyser);
      this._updateWaveform();

      // Set up media recorder
      this._mediaRecorder = new MediaRecorder(stream);
      this._mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this._audioChunks.push(e.data);
        }
      };

      this._mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };

      this._mediaRecorder.start(100);

      // Try to use Web Speech API for real-time transcription
      this._startSpeechRecognition();
    } catch (err) {
      this._state = "error";
      this._error =
        err instanceof Error ? err.message : "Failed to access microphone";
      console.error("Voice recording error:", err);
    }
  }

  private _startSpeechRecognition() {
    // Check if Web Speech API is available
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.log("[voice-recorder] Web Speech API not available, will use server transcription");
      return;
    }

    try {
      console.log("[voice-recorder] Starting speech recognition with language:", this.language);
      this._recognition = new SpeechRecognition();
      this._recognition.continuous = true;
      this._recognition.interimResults = true;
      this._recognition.lang = this.language;

      this._recognition.onresult = (event: SpeechRecognitionEvent) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        this._transcript = transcript;
        console.log("[voice-recorder] Interim transcript:", transcript);
      };

      this._recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.log("[voice-recorder] Speech recognition error:", event.error);
        // Don't fail, we'll use server transcription as fallback
      };

      this._recognition.start();
      console.log("[voice-recorder] Speech recognition started");
    } catch (err) {
      console.log("[voice-recorder] Failed to start speech recognition:", err);
    }
  }

  private _updateWaveform() {
    if (!this._analyser || this._state !== "recording") return;

    const dataArray = new Uint8Array(this._analyser.frequencyBinCount);
    this._analyser.getByteFrequencyData(dataArray);

    // Normalize to 0-1 range and take first 5 values
    this._audioLevels = Array.from(dataArray.slice(0, 5)).map(
      (v) => Math.max(0.1, v / 255)
    );

    this._animationFrame = requestAnimationFrame(() => this._updateWaveform());
  }

  async stopRecording() {
    console.log("[voice-recorder] stopRecording called, state:", this._state);
    if (this._state !== "recording") return;

    this._state = "processing";

    // Stop speech recognition
    if (this._recognition) {
      this._recognition.stop();
      console.log("[voice-recorder] Speech recognition stopped");
    }

    // Stop animation
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }

    // Stop recording and wait for data
    if (this._mediaRecorder && this._mediaRecorder.state !== "inactive") {
      this._mediaRecorder.stop();
    }

    // Wait a bit for final audio chunks
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Get transcript (from Web Speech API or use placeholder)
    const transcript = this._transcript.trim();
    console.log("[voice-recorder] Transcript:", transcript || "(empty)");

    if (transcript) {
      // Dispatch event with transcript
      console.log("[voice-recorder] Dispatching transcript event");
      this.dispatchEvent(
        new CustomEvent("transcript", {
          detail: { transcript, audioBlob: new Blob(this._audioChunks, { type: "audio/webm" }) },
          bubbles: true,
          composed: true,
        })
      );
    } else if (this._audioChunks.length > 0) {
      // No transcript from Web Speech API, send audio for server transcription
      console.log("[voice-recorder] No transcript, dispatching audio-ready event");
      const audioBlob = new Blob(this._audioChunks, { type: "audio/webm" });
      this.dispatchEvent(
        new CustomEvent("audio-ready", {
          detail: { audioBlob },
          bubbles: true,
          composed: true,
        })
      );
    } else {
      console.log("[voice-recorder] No transcript and no audio chunks!");
    }

    this._cleanup();
    this._state = "idle";
    this._transcript = "";
  }

  cancelRecording() {
    this._cleanup();
    this._state = "idle";
    this._transcript = "";
    this._error = "";
  }

  render() {
    if (this._state === "recording") {
      return html`
        <div class="recording-controls">
          <div class="waveform">
            ${this._audioLevels.map(
              (level) =>
                html`<div
                  class="waveform-bar"
                  style="height: ${Math.max(4, level * 20)}px"
                ></div>`
            )}
          </div>
          ${this._transcript
            ? html`<span class="transcript-preview">${this._transcript}</span>`
            : null}
          <button
            class="stop-btn"
            @click=${this.stopRecording}
            title="Stop and send"
          >
            ■
          </button>
          <button
            class="cancel-btn"
            @click=${this.cancelRecording}
            title="Cancel"
          >
            ✕
          </button>
        </div>
      `;
    }

    if (this._state === "processing") {
      return html`
        <button class="mic-btn mic-btn--processing" disabled title="Processing...">
          ⏳
        </button>
      `;
    }

    if (this._state === "error") {
      return html`
        <button
          class="mic-btn mic-btn--error"
          @click=${() => {
            this._state = "idle";
            this._error = "";
          }}
          title=${this._error}
        >
          ⚠
        </button>
        <span class="error-msg">${this._error}</span>
      `;
    }

    return html`
      <button
        class="mic-btn mic-btn--idle"
        ?disabled=${this.disabled}
        @click=${this.startRecording}
        title="Start voice recording (${this.language})"
      >
        🎤
      </button>
    `;
  }
}

/**
 * TTS Speaker using Web Speech Synthesis API
 */
export class WebTTSSpeaker {
  private static _instance: WebTTSSpeaker | null = null;
  private _utterance: SpeechSynthesisUtterance | null = null;
  private _speaking = false;

  static get instance(): WebTTSSpeaker {
    if (!this._instance) {
      this._instance = new WebTTSSpeaker();
    }
    return this._instance;
  }

  get isSpeaking(): boolean {
    return this._speaking;
  }

  speak(text: string, options: { lang?: string; voice?: string; rate?: number } = {}) {
    this.stop();

    if (!("speechSynthesis" in window)) {
      console.warn("Web Speech Synthesis not available");
      return;
    }

    this._utterance = new SpeechSynthesisUtterance(text);
    this._utterance.lang = options.lang || "ro-RO";
    this._utterance.rate = options.rate || 1.0;

    // Try to find the requested voice
    if (options.voice) {
      const voices = speechSynthesis.getVoices();
      const voice = voices.find((v) => v.name === options.voice || v.voiceURI === options.voice);
      if (voice) {
        this._utterance.voice = voice;
      }
    }

    this._utterance.onstart = () => {
      this._speaking = true;
    };

    this._utterance.onend = () => {
      this._speaking = false;
    };

    this._utterance.onerror = () => {
      this._speaking = false;
    };

    speechSynthesis.speak(this._utterance);
  }

  stop() {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }
    this._speaking = false;
  }

  static getVoices(): SpeechSynthesisVoice[] {
    return speechSynthesis.getVoices();
  }

  static getRomanianVoices(): SpeechSynthesisVoice[] {
    return this.getVoices().filter((v) => v.lang.startsWith("ro"));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "voice-recorder": VoiceRecorder;
  }
}
