import { Badge } from "@hippo/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@hippo/ui/card";
import { Wrench } from "lucide-react";
import type { ToolEntry } from "@/lib/use-call";
import { Empty } from "./empty";

export function ToolCalls({ tools }: { tools: ToolEntry[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Tool calls</CardTitle>
        <span className="text-xs text-muted-foreground">{tools.length}</span>
      </CardHeader>
      <CardContent className="space-y-2" data-testid="tool-calls">
        {tools.length === 0 && <Empty icon={Wrench}>The agent's tool calls appear here.</Empty>}
        {[...tools].reverse().map((tool) => (
          <details
            key={tool.toolCallId}
            className="rounded-md border border-border"
            data-testid="tool-call"
            data-tool={tool.name}
            data-status={tool.ok === undefined ? "pending" : tool.ok ? "ok" : tool.error?.code}
          >
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-mono">{tool.name}</span>
              <span className="flex items-center gap-2">
                {tool.latencyMs !== undefined && (
                  <span className="text-xs text-muted-foreground">{tool.latencyMs} ms</span>
                )}
                <Status tool={tool} />
              </span>
            </summary>
            <div className="space-y-2 border-t border-border px-3 py-2 text-xs">
              <Json label="args" value={tool.args} />
              {tool.error && <p className="text-danger">{tool.error.message}</p>}
              {tool.error?.details && <Json label="details" value={tool.error.details} />}
              {tool.result !== undefined && <Json label="result" value={tool.result} />}
            </div>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}

function Status({ tool }: { tool: ToolEntry }) {
  if (tool.ok === undefined) return <Badge tone="info">running</Badge>;
  if (tool.ok) return <Badge tone="success">ok</Badge>;
  return (
    <Badge tone={tool.error?.retryable ? "warning" : "danger"}>{tool.error?.code ?? "error"}</Badge>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-muted-foreground">{label}</div>
      <pre className="overflow-x-auto rounded bg-muted p-2 font-mono">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
