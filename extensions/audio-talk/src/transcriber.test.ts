import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildWhisperArgs, parseWhisperOutput } from "./transcriber.js";
import type { TranscriberOptions } from "./types.js";

describe("transcriber", () => {
  describe("buildWhisperArgs", () => {
    it("builds correct command arguments", () => {
      const opts: TranscriberOptions = {
        binaryPath: "/usr/local/bin/whisper",
        modelPath: "/models/ggml-base.bin",
        language: "ro",
        threads: 4,
        inputPath: "/tmp/audio.wav",
      };

      const args = buildWhisperArgs(opts);

      expect(args).toContain("-m");
      expect(args).toContain("/models/ggml-base.bin");
      expect(args).toContain("-f");
      expect(args).toContain("/tmp/audio.wav");
      expect(args).toContain("-l");
      expect(args).toContain("ro");
      expect(args).toContain("-t");
      expect(args).toContain("4");
      expect(args).toContain("--no-timestamps");
      expect(args).toContain("-otxt");
    });

    it("expands ~ in model path", () => {
      const opts: TranscriberOptions = {
        binaryPath: "whisper",
        modelPath: "~/.cache/whisper/ggml-base.bin",
        language: "en",
        threads: 2,
        inputPath: "/tmp/test.wav",
      };

      const args = buildWhisperArgs(opts);
      const modelIdx = args.indexOf("-m");
      const modelPath = args[modelIdx + 1];

      // Should expand ~ to home directory
      expect(modelPath).not.toContain("~");
      expect(modelPath).toContain(".cache/whisper/ggml-base.bin");
    });
  });

  describe("parseWhisperOutput", () => {
    it("extracts clean text from timestamped output", () => {
      const output = `
[00:00:000 --> 00:02:500]  Hello world
[00:02:500 --> 00:05:000]  This is a test
      `;

      const text = parseWhisperOutput(output);
      expect(text).toBe("Hello world This is a test");
    });

    it("handles output without timestamps", () => {
      const output = "Hello world\nThis is a test\n";
      const text = parseWhisperOutput(output);
      expect(text).toBe("Hello world This is a test");
    });

    it("filters out whisper.cpp log lines", () => {
      const output = `
whisper_init_from_file: loading model...
main: processing audio
Hello world
whisper_print_timings: total time = 1234.56ms
      `;

      const text = parseWhisperOutput(output);
      expect(text).toBe("Hello world");
    });

    it("handles Romanian text", () => {
      const output = `
[00:00:000 --> 00:03:000]  Bună ziua, cum te cheamă?
[00:03:000 --> 00:06:000]  Mă numesc Ion.
      `;

      const text = parseWhisperOutput(output);
      expect(text).toBe("Bună ziua, cum te cheamă? Mă numesc Ion.");
    });

    it("returns empty string for empty output", () => {
      const text = parseWhisperOutput("");
      expect(text).toBe("");
    });

    it("returns empty string for only log lines", () => {
      const output = `
whisper_init_from_file: loading model...
main: processing audio
whisper_print_timings: total time = 1234.56ms
      `;

      const text = parseWhisperOutput(output);
      expect(text).toBe("");
    });

    it("handles mixed timestamp formats", () => {
      const output = `
[00:00.000 --> 00:02.500]  First part
[00:02:500 --> 00:05:000]  Second part
      `;

      const text = parseWhisperOutput(output);
      expect(text).toBe("First part Second part");
    });
  });
});
