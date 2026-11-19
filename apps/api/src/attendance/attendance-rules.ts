import { PointType } from "@prisma/client";
import { DateTime } from "luxon";

export interface ShiftTimes {
  startTime: Date; // wall-clock time stored as 1970-01-01THH:mm UTC
  endTime: Date;
  earlyMinutes: number;
  graceMinutes: number;
  redPeriodMinutes: number;
}

export interface AttendanceWindows {
  scheduledStartAt: Date;
  earlyEndAt: Date;
  graceEndAt: Date;
  redPeriodEndAt: Date;
  scheduledEndAt: Date;
}

type Dated = { effectiveFrom: Date; effectiveTo: Date | null };
const covers = (row: Dated, day: Date) =>
  row.effectiveFrom <= day && (!row.effectiveTo || row.effectiveTo >= day);

/**
 * The shift times and assignment an employee works on `workDate`: the current shift's version in force
 * that day (none if the shift is inactive). Check-in and the absence sweep must judge a day the same way.
 */
export function scheduleForDay<A extends Dated & { shiftId: string }>(
  employee: {
    currentShift: { id: string; isActive: boolean; versions: (ShiftTimes & Dated)[] };
    shiftAssignments: A[];
  },
  workDate: Date,
) {
  const shift = employee.currentShift.isActive
    ? employee.currentShift.versions.find((version) => covers(version, workDate))
    : undefined;
  const assignment = employee.shiftAssignments.find(
    (item) => item.shiftId === employee.currentShift.id && covers(item, workDate),
  );
  return { shift, assignment };
}

// docs/05 §4.1: window instants for one work date, computed in the company timezone and stored as UTC.
export function computeWindows(
  workDate: Date,
  shift: ShiftTimes,
  timezone: string,
): AttendanceWindows {
  const at = (time: Date) =>
    DateTime.fromObject(
      {
        year: workDate.getUTCFullYear(),
        month: workDate.getUTCMonth() + 1,
        day: workDate.getUTCDate(),
        hour: time.getUTCHours(),
        minute: time.getUTCMinutes(),
      },
      { zone: timezone },
    );
  const start = at(shift.startTime);

  return {
    scheduledStartAt: start.toJSDate(),
    earlyEndAt: start.plus({ minutes: shift.earlyMinutes }).toJSDate(),
    graceEndAt: start.plus({ minutes: shift.graceMinutes }).toJSDate(),
    redPeriodEndAt: start.plus({ minutes: shift.redPeriodMinutes }).toJSDate(),
    scheduledEndAt: at(shift.endTime).toJSDate(),
  };
}

// REQ-012: [start, early) GREEN · [early, grace) WHITE · [grace, red) RED · at or after red BLACK.
export function classifyCheckIn(
  checkInAt: Date,
  w: AttendanceWindows,
): PointType | "NOT_OPEN" {
  if (checkInAt < w.scheduledStartAt) return "NOT_OPEN";
  if (checkInAt < w.earlyEndAt) return PointType.GREEN;
  if (checkInAt < w.graceEndAt) return PointType.WHITE;
  if (checkInAt < w.redPeriodEndAt) return PointType.RED;
  return PointType.BLACK;
}

// REQ-014: one GREEN per full hour after the scheduled end.
export function overtimeGreens(checkOutAt: Date, scheduledEndAt: Date): number {
  return Math.max(
    0,
    Math.floor((checkOutAt.getTime() - scheduledEndAt.getTime()) / 3_600_000),
  );
}

// overtime if the employee checks in before his scheduled start time with workOffer
export function beforeTimeGreens(
  checkInAt: Date,
  scheduledStartAt: Date,
): number {
  return Math.max(
    0,
    Math.floor((scheduledStartAt.getTime() - checkInAt.getTime()) / 3_600_000),
  );
}
