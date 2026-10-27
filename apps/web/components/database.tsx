"use client";

import { AdminSnapshot } from "@hippo/contracts";
import { Badge } from "@hippo/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@hippo/ui/card";
import { cn } from "@hippo/ui/cn";
import { Input } from "@hippo/ui/input";
import {
  ArrowLeft,
  CalendarSync,
  ChevronRight,
  Database as DatabaseIcon,
  SearchX,
  Unplug,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  type Appointment,
  appointmentsFor,
  type Doctor,
  displayStatus,
  exists,
  matches,
  type Patient,
  type Status,
  type View,
} from "@/lib/database";
import { INTEGRATOR_URL } from "@/lib/env";
import { Empty } from "./empty";

const TABS = ["appointments", "patients", "doctors"] as const;
type Tab = (typeof TABS)[number];

const STATUS_TONE = { booked: "success", rescheduled: "info", cancelled: "neutral" } as const;

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Database({ version }: { version: number }) {
  const [tab, setTab] = useState<Tab>("appointments");
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<View[]>([]);
  const [data, setData] = useState<AdminSnapshot | null>(null);
  const [error, setError] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch whenever a tool call completes
  useEffect(() => {
    let cancelled = false;
    fetch(`${INTEGRATOR_URL}/admin/snapshot`)
      .then((r) => r.json())
      .then((json) => {
        const d = AdminSnapshot.parse(json);
        if (!cancelled) {
          setData(d);
          setStack((s) => s.filter((v) => exists(d, v)));
          setError(false);
        }
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const view = stack.at(-1);
  const open = (v: View) => setStack((s) => [...s, v]);
  const selectTab = (t: Tab) => {
    setTab(t);
    setQuery("");
    setStack([]);
  };

  return (
    <Card className="h-full">
      <CardHeader className="flex-wrap">
        <CardTitle>Database</CardTitle>
        <div className="flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => selectTab(t)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs capitalize",
                tab === t ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t}
              {data && <span className="tabular-nums opacity-60">{data[t].length}</span>}
            </button>
          ))}
        </div>
      </CardHeader>
      {data && view && (
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          <button
            type="button"
            onClick={() => setStack((s) => s.slice(0, -1))}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            data-testid="db-back"
          >
            <ArrowLeft className="size-3.5" /> Back
          </button>
          <span className="text-xs capitalize text-muted-foreground">{view.kind}</span>
        </div>
      )}
      {data && !view && (
        <div className="border-b border-border px-4 py-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tab}`}
            aria-label={`Search ${tab}`}
            className="h-8 text-xs"
            data-testid="db-search"
          />
        </div>
      )}
      <CardContent className="p-0" data-testid={view ? "db-detail" : `db-${tab}`}>
        {error && <Empty icon={Unplug}>Integrator is offline.</Empty>}
        {data && view && <Detail data={data} view={view} open={open} />}
        {data && !view && <List data={data} tab={tab} query={query} open={open} />}
      </CardContent>
    </Card>
  );
}

function List({
  data,
  tab,
  query,
  open,
}: {
  data: AdminSnapshot;
  tab: Tab;
  query: string;
  open: (v: View) => void;
}) {
  if (data[tab].length === 0) return <Empty icon={DatabaseIcon}>No {tab} yet.</Empty>;

  const rows =
    tab === "appointments"
      ? data.appointments
          .filter((a) => matches(query, [a.patientName, a.doctorName, a.specialty, a.label]))
          .map((a) => (
            <AppointmentRow
              key={a.id}
              appointment={a}
              title={a.patientName}
              subtitle={`${a.doctorName} · ${a.specialty}`}
              meta={a.label}
              onClick={() => open({ kind: "appointment", id: a.id })}
            />
          ))
      : tab === "patients"
        ? data.patients
            .filter((p) => matches(query, [`${p.firstName} ${p.lastName}`, p.dob]))
            .map((p) => (
              <Row
                key={p.id}
                title={`${p.firstName} ${p.lastName}`}
                subtitle={`DOB ${p.dob} · ${appointmentsFor(data.appointments, { patientId: p.id }).length} appointments`}
                onClick={() => open({ kind: "patient", id: p.id })}
              />
            ))
        : data.doctors
            .filter((d) => matches(query, [d.name, d.specialty]))
            .map((d) => (
              <Row
                key={d.id}
                title={d.name}
                subtitle={d.specialty}
                badge={!d.active && <Badge>inactive</Badge>}
                onClick={() => open({ kind: "doctor", id: d.id })}
              />
            ));

  if (rows.length === 0)
    return (
      <Empty icon={SearchX}>
        No {tab} match “{query.trim()}”.
      </Empty>
    );
  return <ul className="divide-y divide-border">{rows}</ul>;
}

function Detail({
  data,
  view,
  open,
}: {
  data: AdminSnapshot;
  view: View;
  open: (v: View) => void;
}) {
  if (view.kind === "appointment") {
    const a = data.appointments.find((r) => r.id === view.id);
    return a ? <AppointmentDetail data={data} appointment={a} open={open} /> : null;
  }
  if (view.kind === "patient") {
    const p = data.patients.find((r) => r.id === view.id);
    return p ? <PatientDetail data={data} patient={p} open={open} /> : null;
  }
  const d = data.doctors.find((r) => r.id === view.id);
  return d ? <DoctorDetail data={data} doctor={d} open={open} /> : null;
}

function AppointmentDetail({
  data,
  appointment: a,
  open,
}: {
  data: AdminSnapshot;
  appointment: Appointment;
  open: (v: View) => void;
}) {
  const patient = data.patients.find((p) => p.id === a.patientId);
  const doctor = data.doctors.find((d) => d.id === a.doctorId);
  const movedTo = data.appointments.find((r) => r.id === a.rescheduledTo);
  const movedFrom = data.appointments.find((r) => r.id === a.rescheduledFrom);

  return (
    <>
      <Heading title={a.label} badge={<StatusBadge status={displayStatus(a)} />} />
      <Fields
        fields={[
          ["Reason", a.reason ?? "—"],
          ["Created", dateTime.format(new Date(a.createdAt))],
        ]}
      />
      <Section title="Patient">
        <Row
          title={a.patientName}
          subtitle={patient && `DOB ${patient.dob}`}
          onClick={patient && (() => open({ kind: "patient", id: patient.id }))}
        />
      </Section>
      <Section title="Doctor">
        <Row
          title={a.doctorName}
          subtitle={a.specialty}
          onClick={doctor && (() => open({ kind: "doctor", id: doctor.id }))}
        />
      </Section>
      {a.rescheduledTo && (
        <Section title="Moved to">
          <LinkedAppointment id={a.rescheduledTo} appointment={movedTo} open={open} />
        </Section>
      )}
      {a.rescheduledFrom && (
        <Section title="Moved from">
          <LinkedAppointment id={a.rescheduledFrom} appointment={movedFrom} open={open} />
        </Section>
      )}
    </>
  );
}

function LinkedAppointment({
  id,
  appointment,
  open,
}: {
  id: string;
  appointment: Appointment | undefined;
  open: (v: View) => void;
}) {
  if (!appointment) {
    return <Row title="Older appointment" subtitle="Outside the latest 100 records" />;
  }
  return (
    <AppointmentRow
      appointment={appointment}
      title={appointment.label}
      subtitle={`${appointment.doctorName} · ${appointment.specialty}`}
      onClick={() => open({ kind: "appointment", id })}
    />
  );
}

function PatientDetail({
  data,
  patient: p,
  open,
}: {
  data: AdminSnapshot;
  patient: Patient;
  open: (v: View) => void;
}) {
  return (
    <>
      <Heading title={`${p.firstName} ${p.lastName}`} />
      <Fields
        fields={[
          ["Date of birth", p.dob],
          ["Added", dateTime.format(new Date(p.createdAt))],
        ]}
      />
      <Appointments
        appointments={appointmentsFor(data.appointments, { patientId: p.id })}
        subtitle={(a) => `${a.doctorName} · ${a.specialty}`}
        open={open}
      />
    </>
  );
}

function DoctorDetail({
  data,
  doctor: d,
  open,
}: {
  data: AdminSnapshot;
  doctor: Doctor;
  open: (v: View) => void;
}) {
  return (
    <>
      <Heading
        title={d.name}
        badge={
          <Badge tone={d.active ? "success" : "neutral"}>{d.active ? "active" : "inactive"}</Badge>
        }
      />
      <Fields fields={[["Specialty", d.specialty]]} />
      <Appointments
        appointments={appointmentsFor(data.appointments, { doctorId: d.id })}
        subtitle={(a) => a.patientName}
        open={open}
      />
    </>
  );
}

function Appointments({
  appointments,
  subtitle,
  open,
}: {
  appointments: Appointment[];
  subtitle: (a: Appointment) => string;
  open: (v: View) => void;
}) {
  return (
    <Section title={`Appointments · ${appointments.length}`}>
      {appointments.length === 0 ? (
        <li className="px-4 py-2 text-sm text-muted-foreground">None.</li>
      ) : (
        appointments.map((a) => (
          <AppointmentRow
            key={a.id}
            appointment={a}
            title={a.label}
            subtitle={subtitle(a)}
            onClick={() => open({ kind: "appointment", id: a.id })}
          />
        ))
      )}
    </Section>
  );
}

function AppointmentRow({
  appointment: a,
  title,
  subtitle,
  meta,
  onClick,
}: {
  appointment: Appointment;
  title: string;
  subtitle: string;
  meta?: string;
  onClick: () => void;
}) {
  const status = displayStatus(a);
  return (
    <Row
      title={title}
      subtitle={subtitle}
      meta={meta}
      badge={
        <>
          {a.rescheduledFrom && (
            <CalendarSync className="size-3.5 shrink-0 text-muted-foreground" aria-label="Moved" />
          )}
          <StatusBadge status={status} />
        </>
      }
      muted={status !== "booked"}
      onClick={onClick}
    />
  );
}

function Row({
  title,
  subtitle,
  meta,
  badge,
  muted,
  onClick,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: ReactNode;
  muted?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className={cn("min-w-0 flex-1", muted && "opacity-60")}>
        <div className="truncate font-medium">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
      </div>
      {badge}
    </>
  );
  const className = "flex w-full items-center gap-3 px-4 py-2 text-left text-sm";
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            className,
            "group hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
          )}
          data-testid="db-row"
        >
          {body}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>
      ) : (
        <div className={className} data-testid="db-row">
          {body}
        </div>
      )}
    </li>
  );
}

function Heading({ title, badge }: { title: string; badge?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
      <h3 className="font-semibold">{title}</h3>
      {badge}
    </div>
  );
}

function Fields({ fields }: { fields: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-4 pb-3 text-sm">
      {fields.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border">
      <h4 className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{title}</h4>
      <ul className="divide-y divide-border pb-1">{children}</ul>
    </section>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}
