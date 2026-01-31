import { describe, it, expect } from "vitest";
import { buildSayArgs, escapeTextForSay } from "./speaker.js";
import type { SpeakerOptions } from "./types.js";

describe("speaker", () => {
  describe("escapeTextForSay", () => {
    it("passes through normal text unchanged", () => {
      const text = "Hello, how are you?";
      expect(escapeTextForSay(text)).toBe(text);
    });

    it("removes control characters", () => {
      const text = "Hello\x00World\x1fTest";
      expect(escapeTextForSay(text)).toBe("Hello World Test");
    });

    it("trims whitespace", () => {
      const text = "  Hello world  ";
      expect(escapeTextForSay(text)).toBe("Hello world");
    });

    it("handles Romanian text with diacritics", () => {
      const text = "Bună ziua! Cum te cheamă?";
      expect(escapeTextForSay(text)).toBe("Bună ziua! Cum te cheamă?");
    });

    it("handles quotes in text", () => {
      const text = 'He said "hello" and she replied \'hi\'';
      expect(escapeTextForSay(text)).toBe(text);
    });

    it("handles empty text", () => {
      expect(escapeTextForSay("")).toBe("");
    });

    it("handles newlines (treated as control chars)", () => {
      const text = "Line one\nLine two";
      expect(escapeTextForSay(text)).toBe("Line one Line two");
    });
  });

  describe("buildSayArgs", () => {
    it("builds args without voice", () => {
      const opts: SpeakerOptions = {
        text: "Hello world",
      };

      const args = buildSayArgs(opts);
      expect(args).toEqual(["Hello world"]);
    });

    it("builds args with voice", () => {
      const opts: SpeakerOptions = {
        text: "Hello world",
        voice: "Samantha",
      };

      const args = buildSayArgs(opts);
      expect(args).toEqual(["-v", "Samantha", "Hello world"]);
    });

    it("handles text with special characters", () => {
      const opts: SpeakerOptions = {
        text: "What's up? How are you!",
        voice: "Alex",
      };

      const args = buildSayArgs(opts);
      expect(args).toContain("-v");
      expect(args).toContain("Alex");
      expect(args).toContain("What's up? How are you!");
    });

    it("cleans text before building args", () => {
      const opts: SpeakerOptions = {
        text: "  Hello\x00World  ",
      };

      const args = buildSayArgs(opts);
      expect(args).toEqual(["Hello World"]);
    });
  });
});
