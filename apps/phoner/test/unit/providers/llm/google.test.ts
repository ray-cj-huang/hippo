import type { Content } from "@google/genai";
import { describe, expect, it } from "vitest";
import { withText } from "../../../../src/providers/llm/google";

const call = { functionCall: { name: "verify_patient", args: {} }, thoughtSignature: "sig" };

describe("withText", () => {
  it("returns the content unchanged when the text matches", () => {
    const content: Content = { role: "model", parts: [{ text: "One moment." }, call] };
    expect(withText(content, "One moment.")).toBe(content);
  });

  it("replaces spoken text and keeps thoughts and signed function calls", () => {
    const content: Content = {
      role: "model",
      parts: [
        { text: "planning", thought: true },
        { text: "Let me check. " },
        { text: "This is slow." },
        call,
      ],
    };
    expect(withText(content, "Let me check.")).toEqual({
      role: "model",
      parts: [{ text: "planning", thought: true }, { text: "Let me check." }, call],
    });
  });

  it("drops the text when none was heard", () => {
    const content: Content = { role: "model", parts: [{ text: "Hello." }, call] };
    expect(withText(content, "")).toEqual({ role: "model", parts: [call] });
  });
});
