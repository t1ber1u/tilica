import { describe, it, expect } from "vitest";
import { buildFfmpegArgs, generateTempPath } from "./recorder.js";
import type { RecorderOptions } from "./types.js";

describe("recorder", () => {
  describe("buildFfmpegArgs", () => {
    it("builds correct ffmpeg arguments", () => {
      const opts: RecorderOptions = {
        ffmpegPath: "ffmpeg",
        device: ":default",
        sampleRate: 16000,
        maxDurationSec: 30,
        outputPath: "/tmp/test.wav",
      };

      const args = buildFfmpegArgs(opts);

      expect(args).toContain("-f");
      expect(args).toContain("avfoundation");
      expect(args).toContain("-i");
      expect(args).toContain(":default");
      expect(args).toContain("-ac");
      expect(args).toContain("1");
      expect(args).toContain("-ar");
      expect(args).toContain("16000");
      expect(args).toContain("-t");
      expect(args).toContain("30");
      expect(args).toContain("-c:a");
      expect(args).toContain("pcm_s16le");
      expect(args).toContain("-y");
      expect(args).toContain("/tmp/test.wav");
    });

    it("handles custom device", () => {
      const opts: RecorderOptions = {
        ffmpegPath: "/usr/local/bin/ffmpeg",
        device: ":0",
        sampleRate: 44100,
        maxDurationSec: 60,
        outputPath: "/var/tmp/audio.wav",
      };

      const args = buildFfmpegArgs(opts);

      expect(args).toContain(":0");
      expect(args).toContain("44100");
      expect(args).toContain("60");
      expect(args).toContain("/var/tmp/audio.wav");
    });

    it("produces correct argument order", () => {
      const opts: RecorderOptions = {
        ffmpegPath: "ffmpeg",
        device: ":default",
        sampleRate: 16000,
        maxDurationSec: 30,
        outputPath: "/tmp/out.wav",
      };

      const args = buildFfmpegArgs(opts);

      // Input options should come before output
      const inputIdx = args.indexOf("-i");
      const outputIdx = args.indexOf("/tmp/out.wav");

      expect(inputIdx).toBeLessThan(outputIdx);
    });
  });

  describe("generateTempPath", () => {
    it("generates unique paths", () => {
      const path1 = generateTempPath();
      const path2 = generateTempPath();

      expect(path1).not.toBe(path2);
    });

    it("generates paths with .wav extension", () => {
      const path = generateTempPath();
      expect(path).toMatch(/\.wav$/);
    });

    it("generates paths in temp directory", () => {
      const path = generateTempPath();
      expect(path).toContain("clawdbot_rec_");
    });

    it("generates paths with uuid segment", () => {
      const path = generateTempPath();
      // Should have 8-char hex segment after "clawdbot_rec_"
      expect(path).toMatch(/clawdbot_rec_[a-f0-9]{8}\.wav$/);
    });
  });
});
