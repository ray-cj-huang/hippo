import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { withText } from "../../../../src/providers/llm/anthropic";

const thinking: Anthropic.ContentBlockParam = {
  type: "thinking",
  thinking: "Look them up.",
  signature: "sig",
};
const toolUse: Anthropic.ContentBlockParam = {
  type: "tool_use",
  id: "toolu_1",
  name: "verify_patient",
  input: {},
};

describe("withText", () => {
  it("returns the blocks unchanged when the text matches", () => {
    const blocks = [thinking, { type: "text" as const, text: "One moment." }, toolUse];
    expect(withText(blocks, "One moment.")).toBe(blocks);
  });

  it("replaces the text before the tool call and keeps thinking blocks", () => {
    const blocks = [
      thinking,
      { type: "text" as const, text: "Let me check. " },
      { type: "text" as const, text: "This is slow." },
      toolUse,
    ];
    expect(withText(blocks, "Let me check.")).toEqual([
      thinking,
      { type: "text", text: "Let me check." },
      toolUse,
    ]);
  });

  it("drops the text when none was heard", () => {
    expect(withText([thinking, { type: "text", text: "Hello." }, toolUse], "")).toEqual([
      thinking,
      toolUse,
    ]);
  });
});
