/**
 * Checks whether the monthly print count for a booth has just crossed the
 * `notice_print` threshold, and if so, fires a notification email to
 * memento.photobox.
 *
 * Call this after every successful payment insertion.
 */

import { db } from "@/utils/supabase/server";
import { sendNoticePrintEmail } from "@/app/dashboard/mail";

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
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

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

    const monthLabel = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

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
