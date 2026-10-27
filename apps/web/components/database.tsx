"use client";

import type { AdminSnapshot } from "@hippo/contracts";
import { Badge } from "@hippo/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@hippo/ui/card";
import { cn } from "@hippo/ui/cn";
import { Database as DatabaseIcon, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { INTEGRATOR_URL } from "@/lib/env";
import { Empty } from "./empty";

const TABS = ["appointments", "patients", "doctors"] as const;
type Tab = (typeof TABS)[number];

export function Database({ version }: { version: number }) {
  const [tab, setTab] = useState<Tab>("appointments");
  const [data, setData] = useState<AdminSnapshot | null>(null);
  const [error, setError] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch whenever a tool call completes
  useEffect(() => {
    let cancelled = false;
    fetch(`${INTEGRATOR_URL}/admin/snapshot`)
      .then((r) => r.json() as Promise<AdminSnapshot>)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(false);
        }
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Database</CardTitle>
        <div className="flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-2 py-1 text-xs capitalize",
                tab === t ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0" data-testid={`db-${tab}`}>
        {error && <Empty icon={Unplug}>Integrator is offline.</Empty>}
        {data && tab === "appointments" && (
          <Table
            empty="No appointments yet."
            rows={data.appointments.map((a) => ({
              key: a.id,
              cells: [a.patientName, `${a.doctorName} · ${a.specialty}`, a.label],
              badge: <Badge tone={a.status === "booked" ? "success" : "neutral"}>{a.status}</Badge>,
            }))}
          />
        )}
        {data && tab === "patients" && (
          <Table
            empty="No patients."
            rows={data.patients.map((p) => ({
              key: p.id,
              cells: [`${p.firstName} ${p.lastName}`, `DOB ${p.dob}`],
            }))}
          />
        )}
        {data && tab === "doctors" && (
          <Table
            empty="No doctors."
            rows={data.doctors.map((d) => ({ key: d.id, cells: [d.name, d.specialty] }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

type Row = { key: string; cells: string[]; badge?: React.ReactNode };

function Table({ rows, empty }: { rows: Row[]; empty: string }) {
  if (rows.length === 0) return <Empty icon={DatabaseIcon}>{empty}</Empty>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
          data-testid="db-row"
        >
          <div className="min-w-0">
            <div className="truncate font-medium">{row.cells[0]}</div>
            <div className="truncate text-xs text-muted-foreground">
              {row.cells.slice(1).join(" · ")}
            </div>
          </div>
          {row.badge}
        </li>
      ))}
    </ul>
  );
}
