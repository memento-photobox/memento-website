import { toGmt7DayEndISOString, toGmt7DayStartISOString } from "@/app/lib/timezone";

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCurrentMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    from: formatInputDate(start),
    to: formatInputDate(end),
  };
}

export function resolveDateRange(from?: string, to?: string, mode?: string) {
  if (mode === "all") {
    return {
      from: "",
      to: "",
      isDefaultMonth: false,
      hasFilter: false,
    };
  }

  const fallback = getCurrentMonthRange();

  if (from || to) {
    return {
      from: from || "",
      to: to || "",
      isDefaultMonth: false,
      hasFilter: true,
    };
  }

  return {
    from: fallback.from,
    to: fallback.to,
    isDefaultMonth: !from && !to,
    hasFilter: true,
  };
}

export function toIsoRange(from?: string, to?: string) {
  return {
    fromIso: from ? toGmt7DayStartISOString(from) : null,
    toIso: to ? toGmt7DayEndISOString(to) : null,
  };
}