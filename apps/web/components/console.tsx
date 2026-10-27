"use client";

import { Badge } from "@hippo/ui/badge";
import { Button } from "@hippo/ui/button";
import { cn } from "@hippo/ui/cn";
import { Keyboard, Mic, PhoneOff } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { INTEGRATOR_URL, PHONER_URL } from "@/lib/env";
import { type CallStatus, useCall } from "@/lib/use-call";
import { Conversation } from "./conversation";
import { Database } from "./database";
import { Orb } from "./orb";
import { ToolCalls } from "./tool-calls";

const LABELS: Record<CallStatus, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  ended: "Call ended",
  error: "Error",
};

export function Console() {
  const call = useCall();
  const scenario = useSearchParams().get("scenario") ?? undefined;
  const backend = useBackendHealth();
  const live = !["idle", "ended", "error"].includes(call.status);

  return (
    <main className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-4 p-4 lg:h-dvh">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Image src="/hippo.svg" alt="" width={36} height={36} priority />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Hippo</h1>
            <p className="text-sm text-muted-foreground">Hippo Medical Center · scheduling agent</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ServiceDot name="phoner" online={backend.phoner} />
          <ServiceDot name="integrator" online={backend.integrator} />
        </div>
      </header>

      {(!backend.phoner || !backend.integrator) && (
        <p
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          data-testid="offline-banner"
        >
          The voice backend runs locally for now. Start it with{" "}
          <code className="font-mono">pnpm dev</code>, then refresh.
        </p>
      )}

      <section className="flex flex-col items-center gap-3 py-2">
        <Orb status={call.status} level={() => Math.max(call.level, call.agentLevel())} />
        <Badge
          tone={call.status === "error" ? "danger" : "neutral"}
          aria-live="polite"
          data-testid="call-status"
        >
          {LABELS[call.status]}
        </Badge>
        <div className="flex gap-2">
          {live ? (
            <Button variant="danger" onClick={call.end} data-testid="end-call">
              <PhoneOff className="size-4" /> End call
            </Button>
          ) : (
            <>
              <Button
                onClick={() => call.start({ voice: true, scenario })}
                disabled={!backend.phoner}
                data-testid="start-voice"
              >
                <Mic className="size-4" /> Start call
              </Button>
              <Button
                variant="outline"
                onClick={() => call.start({ voice: false, scenario })}
                disabled={!backend.phoner}
                data-testid="start-text"
              >
                <Keyboard className="size-4" /> Text only
              </Button>
            </>
          )}
        </div>
        {call.errors.length > 0 && (
          <p className="text-xs text-danger" data-testid="errors">
            {call.errors.at(-1)}
          </p>
        )}
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        <Conversation
          transcript={call.transcript}
          partial={call.partial}
          canType={live}
          onSay={call.say}
        />
        <ToolCalls tools={call.tools} />
        <Database version={call.dbVersion} />
      </div>
    </main>
  );
}

function ServiceDot({ name, online }: { name: string; online: boolean }) {
  const label = `${name} ${online ? "online" : "offline"}`;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={label}>
      <span className={cn("size-2 rounded-full", online ? "bg-success" : "bg-danger")} />
      {name}
      <span className="sr-only">{online ? "online" : "offline"}</span>
    </span>
  );
}

function useBackendHealth() {
  const [health, setHealth] = useState({ phoner: true, integrator: true });
  useEffect(() => {
    const check = async (url: string) => {
      try {
        return (await fetch(`${url}/health`, { cache: "no-store" })).ok;
      } catch {
        return false;
      }
    };
    const run = async () =>
      setHealth({ phoner: await check(PHONER_URL), integrator: await check(INTEGRATOR_URL) });
    void run();
    const timer = setInterval(run, 10_000);
    return () => clearInterval(timer);
  }, []);
  return health;
}
