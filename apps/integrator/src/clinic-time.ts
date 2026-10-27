import { TZDate } from "@date-fns/tz";
import { addDays, differenceInYears, format, getDay, parseISO } from "date-fns";

export const SLOT_MINUTES = 30;

export class ClinicTime {
  constructor(readonly timezone: string) {}

  toLocal(instant: Date): TZDate {
    return new TZDate(instant.getTime(), this.timezone);
  }

  localDate(instant: Date): string {
    return format(this.toLocal(instant), "yyyy-MM-dd");
  }

  addDaysToDate(date: string, days: number): string {
    return format(addDays(parseISO(date), days), "yyyy-MM-dd");
  }

  weekday(date: string): number {
    return getDay(parseISO(date));
  }

  instant(date: string, time: string): Date {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const [hh, mm] = time.split(":").map(Number) as [number, number];
    return new Date(new TZDate(y, m - 1, d, hh, mm, this.timezone).getTime());
  }

  dayBounds(date: string): { start: Date; end: Date } {
    return {
      start: this.instant(date, "00:00"),
      end: this.instant(this.addDaysToDate(date, 1), "00:00"),
    };
  }

  label(instant: Date): string {
    return format(this.toLocal(instant), "EEEE, MMMM do 'at' h:mm a");
  }

  dateLabel(date: string): string {
    return format(parseISO(date), "EEEE, MMMM do");
  }

  ageOn(dob: string, instant: Date): number {
    return differenceInYears(parseISO(this.localDate(instant)), parseISO(dob));
  }
}

export function bookingWindow(clock: ClinicTime, now: Date, days: number) {
  const today = clock.localDate(now);
  return {
    today,
    earliest: clock.addDaysToDate(today, 1),
    latest: clock.addDaysToDate(today, days),
  };
}
