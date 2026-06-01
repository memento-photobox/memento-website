export const GMT7_TIME_ZONE = "Asia/Jakarta";
export const GMT7_OFFSET = "+07:00";

const GMT7_OFFSET_MINUTES = 7 * 60;

function shiftToGmt7(date: Date) {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60_000;
  return new Date(utcMs + GMT7_OFFSET_MINUTES * 60_000);
}

export function toGmt7OffsetISOString(
  date = new Date(),
  options?: { includeMilliseconds?: boolean },
) {
  const includeMilliseconds = options?.includeMilliseconds ?? true;
  const base = shiftToGmt7(date).toISOString();

  if (includeMilliseconds) {
    return base.replace(/Z$/, GMT7_OFFSET);
  }

  return base.replace(/\.\d{3}Z$/, GMT7_OFFSET);
}

export function toGmt7DayStartISOString(dateInput: string) {
  return `${dateInput}T00:00:00.000${GMT7_OFFSET}`;
}

export function toGmt7DayEndISOString(dateInput: string) {
  return `${dateInput}T23:59:59.999${GMT7_OFFSET}`;
}

export function toGmt7YmdCompact(date = new Date()) {
  return toGmt7OffsetISOString(date, { includeMilliseconds: false })
    .slice(0, 10)
    .replace(/-/g, "");
}

export function formatDateTimeGmt7(
  value: Date | string,
  options?: Intl.DateTimeFormatOptions,
  locale = "id-ID",
) {
  return new Date(value).toLocaleString(locale, {
    timeZone: GMT7_TIME_ZONE,
    ...options,
  });
}

export function formatDateGmt7(
  value: Date | string,
  options?: Intl.DateTimeFormatOptions,
  locale = "id-ID",
) {
  return new Date(value).toLocaleDateString(locale, {
    timeZone: GMT7_TIME_ZONE,
    ...options,
  });
}

export function dateTimeInputToGmt7ISOString(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const [datePart, timePart = "00:00:00"] = trimmed.split("T");
  const normalizedTime =
    timePart.length === 5
      ? `${timePart}:00`
      : timePart.length === 8
        ? timePart
        : `${timePart}:00`;

  return `${datePart}T${normalizedTime}${GMT7_OFFSET}`;
}
