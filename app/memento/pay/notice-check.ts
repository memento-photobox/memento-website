/**
 * Checks whether the monthly print count for a booth has just crossed the
 * `notice_print` threshold, and if so, fires a notification email to
 * memento.photobox.
 *
 * Call this after every successful payment insertion.
 */

import { db } from "@/utils/supabase/server";
import { sendNoticePrintEmail } from "@/app/dashboard/mail";
import { formatDateGmt7, toGmt7DayEndISOString, toGmt7DayStartISOString, toGmt7OffsetISOString } from "@/app/lib/timezone";

export async function checkAndSendNoticePrint(boothid: string): Promise<void> {
  try {
    const supabase = await db();

    // 1. Fetch booth info (notice_print + name)
    const { data: booth, error: boothErr } = await supabase
      .from("booth")
      .select("id, name, notice_print")
      .eq("id", Number(boothid))
      .single();

    if (boothErr || !booth || booth.notice_print == null) return;

    const noticePrint: number = booth.notice_print;

    // 2. Count prints for the current calendar month
    const now = new Date();
    const [yearStr, monthStr] = toGmt7OffsetISOString(now, { includeMilliseconds: false })
      .slice(0, 10)
      .split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const monthStart = toGmt7DayStartISOString(
      `${yearStr}-${monthStr}-01`
    );
    const monthEnd = toGmt7DayEndISOString(
      `${yearStr}-${monthStr}-${String(lastDay).padStart(2, "0")}`
    );

    const { count, error: countErr } = await supabase
      .from("memento")
      .select("uuid", { count: "exact", head: true })
      .eq("boothid", boothid)
      .gte("created_at", monthStart)
      .lte("created_at", monthEnd);

    if (countErr || count == null) {
      console.error("[notice-check] Count query failed:", countErr);
      return;
    }

    const currentMonthPrints = count;

    // Fire when the count has just reached OR crossed the threshold
    // (>= guards against any edge case where a batch might skip the exact value)
    if (currentMonthPrints < noticePrint) return;
    // Only send once — when count is exactly at the threshold
    if (currentMonthPrints > noticePrint) return;

    const monthLabel = formatDateGmt7(now, { month: "long", year: "numeric" });

    await sendNoticePrintEmail(
      booth.id,
      booth.name ?? "",
      noticePrint,
      currentMonthPrints,
      monthLabel,
    );
  } catch (e) {
    // Never let a notice failure break the payment flow
    console.error("[notice-check] Failed to send notice print email:", e);
  }
}
