import Link from "next/link";

import DashboardShell from "../_components/dashboard-shell";
import { requireDashboardSession } from "../auth";
import { currency } from "../mock-data";
import { db } from "@/utils/supabase/server";
import DateRangeFilter from "@/app/dashboard/_components/date-range-filter";
import { formatDateGmt7 } from "@/app/lib/timezone";
import { resolveDateRange, toIsoRange } from "../date-range";

type DashboardBoothsPageProps = {
  searchParams: Promise<{ from?: string; to?: string; mode?: string }>;
};

export default async function DashboardBoothsPage({ searchParams }: DashboardBoothsPageProps) {
  const session = await requireDashboardSession();
  if (session.role !== "superuser") {
    return (
      <DashboardShell session={session} active="booths">
        <p className="text-slate-400">Akses hanya untuk superuser.</p>
      </DashboardShell>
    );
  }

  const supabase = await db();
  const params = await searchParams;
  const { from: fromDate, to: toDate, isDefaultMonth, hasFilter } = resolveDateRange(
    params.from,
    params.to,
    params.mode
  );
  const { fromIso, toIso } = toIsoRange(fromDate, toDate);

  // Fetch all booths
  const [{ data: booths }, { data: boothStatsRows }] = await Promise.all([
    supabase
      .from("booth")
      .select("id, name, price")
      .order("id", { ascending: true }),
    supabase.rpc("dashboard_booth_stats", {
      p_from: fromIso,
      p_to: toIso,
    }),
  ]);

  const boothList = (booths ?? []) as { id: number; name: string; price: number }[];

  const boothStats: Record<number, { prints: number; revenue: number }> = {};

  for (const row of (boothStatsRows ?? []) as Array<{ booth_id: number; total_prints: number; total_revenue: number }>) {
    boothStats[row.booth_id] = {
      prints: Number(row.total_prints ?? 0),
      revenue: Number(row.total_revenue ?? 0),
    };
  }

  return (
    <DashboardShell session={session} active="booths">
      <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-5">
        <h1 className="text-2xl font-bold">Booths Management</h1>
        <p className="mt-1 text-sm text-slate-300">
          Lihat status aktif booth, akses set pricing, dan cek laporan per booth.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Filter Periode</h3>
            {hasFilter ? (
              <p className="mt-1 text-xs text-indigo-300">
                {isDefaultMonth
                  ? `Bulan ini · ${formatDateGmt7(fromDate, { dateStyle: "medium" })} — ${formatDateGmt7(toDate, { dateStyle: "medium" })}`
                  : `${formatDateGmt7(fromDate, { dateStyle: "medium" })} — ${formatDateGmt7(toDate, { dateStyle: "medium" })}`}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Semua waktu</p>
            )}
          </div>
        </div>
        <div className="mt-3">
          <DateRangeFilter basePath="/dashboard/booths" initialFrom={fromDate} initialTo={toDate} />
        </div>
      </section>

      <section className="space-y-3">
        {boothList.length === 0 ? (
          <p className="py-6 text-center text-slate-500">Belum ada booth terdaftar.</p>
        ) : null}

        {boothList.map((booth) => {
          const stats = boothStats[booth.id] || { prints: 0, revenue: 0 };

          return (
            <article key={booth.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {booth.name || `Booth ${booth.id}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    ID: {booth.id} · Harga: {currency(booth.price ?? 0)}
                  </p>
                </div>

                <div className="text-right text-xs sm:text-sm">
                  <p className="text-slate-300">
                    Revenue: <span className="font-semibold text-white">{currency(stats.revenue)}</span>
                  </p>
                  <p className="text-slate-300">
                    Total Print: <span className="font-semibold text-white">{stats.prints.toLocaleString("id-ID")}</span>
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/dashboard/booths/${booth.id}${hasFilter ? `?from=${fromDate}&to=${toDate}` : "?mode=all"}`}
                  className="rounded-lg border border-slate-700 px-3 py-1 text-xs hover:bg-slate-800"
                >
                  Lihat Detail Booth
                </Link>
              </div>
            </article>
          );
        })}
      </section>
    </DashboardShell>
  );
}
