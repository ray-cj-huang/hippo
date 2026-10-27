import { describe, expect, it } from "vitest";
import { SentenceChunker } from "../../../src/pipeline/sentence-chunker";

function chunk(...pieces: string[]) {
  const chunker = new SentenceChunker();
  return [...pieces.flatMap((p) => chunker.push(p)), ...chunker.flush()];
}

describe("SentenceChunker", () => {
  it("splits on sentence punctuation across streamed pieces", () => {
    expect(chunk("Sure. Let me ch", "eck that! Is 9", ":30 okay?")).toEqual([
      "Sure.",
      "Let me check that!",
      "Is 9:30 okay?",
    ]);
  });

  it("does not split after titles and abbreviations", () => {
    expect(chunk("Dr. Chen is free at 9 a.m. tomorrow. Book it?")).toEqual([
      "Dr. Chen is free at 9 a.m. tomorrow.",
      "Book it?",
    ]);
  });

  it("keeps decimals together", () => {
    expect(chunk("It costs 12.50 dollars.")).toEqual(["It costs 12.50 dollars."]);
  });

  it("flushes very long runs at a word boundary", () => {
    const [first] = chunk(`${"word ".repeat(60)}end`);
    expect(first?.length).toBeLessThanOrEqual(221);
  });
});
