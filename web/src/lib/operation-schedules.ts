export const OPERATION_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const OPERATION_WEEKDAY_LABELS: Record<OperationWeekday, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

export type OperationWeekday = (typeof OPERATION_WEEKDAYS)[number];

export type OperationSchedule = {
  id: string;
  academy_id?: string;
  weekdays: string[];
  start_time: string;
  end_time: string;
  effective_start: string;
  effective_end: string;
  is_active: boolean;
  updated_at?: string;
};

export function findOperationSchedule(schedules: OperationSchedule[], weekday: string) {
  return schedules.find((schedule) => schedule.is_active && schedule.weekdays.includes(weekday)) ?? null;
}

export function formatOperationWeekdays(weekdays: string[]) {
  return OPERATION_WEEKDAYS.filter((weekday) => weekdays.includes(weekday)).map((weekday) => OPERATION_WEEKDAY_LABELS[weekday]).join(", ");
}
