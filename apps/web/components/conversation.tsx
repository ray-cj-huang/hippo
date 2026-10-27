"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@hippo/ui/card";
import { Input } from "@hippo/ui/input";
import { MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "@/lib/use-call";
import { Empty } from "./empty";

type Props = {
  transcript: TranscriptEntry[];
  partial: string;
  canType: boolean;
  onSay: (text: string) => void;
};

export function Conversation({ transcript, partial, canType, onSay }: Props) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever new text arrives
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [transcript, partial]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Conversation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3" data-testid="transcript">
        {transcript.length === 0 && !partial && (
          <Empty icon={MessageSquare}>Start a call to see the transcript.</Empty>
        )}
        {transcript.map((entry) => (
          <Message key={entry.id} entry={entry} />
        ))}
        {partial && (
          <div className="ml-auto max-w-[85%] rounded-lg px-3 py-2 text-sm italic text-muted-foreground">
            {partial}…
          </div>
        )}
        <div ref={end} />
      </CardContent>
      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSay(draft);
          setDraft("");
        }}
      >
        <Input
          aria-label="Type as the caller"
          data-testid="caller-input"
          placeholder={canType ? "Type as the caller and press Enter" : "Start a call to type"}
          value={draft}
          disabled={!canType}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
    </Card>
  );
}

function Message({ entry }: { entry: TranscriptEntry }) {
  const caller = entry.role === "caller";
  return (
    <div
      className={caller ? "flex flex-col items-end gap-1" : "flex flex-col items-start gap-1"}
      data-testid={`message-${entry.role}`}
    >
      <span className="px-1 text-xs text-muted-foreground">{caller ? "Caller" : "Agent"}</span>
      <div
        className={
          caller
            ? "max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
            : "max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm"
        }
      >
        {entry.interrupted ? (
          <>
            <span data-testid="heard-text">{entry.interrupted.heardText}</span>{" "}
            <span data-testid="unheard-text" className="text-muted-foreground line-through">
              {entry.text.slice(entry.interrupted.heardText.length)}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">Interrupted by caller</span>
          </>
        ) : (
          entry.text
        )}
      </div>
    </div>
  );
}
