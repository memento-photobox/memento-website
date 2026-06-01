import Link from "next/link";

import DashboardShell from "./_components/dashboard-shell";
import { requireDashboardSession } from "./auth";
import { currency } from "./mock-data";
import { db } from "@/utils/supabase/server";
import DownloadXlsButton from "@/app/dashboard/_components/download-xls-button";
import DateRangeFilter from "@/app/dashboard/_components/date-range-filter";
import { formatDateGmt7, formatDateTimeGmt7 } from "@/app/lib/timezone";
import { resolveDateRange, toIsoRange } from "./date-range";

const PAGE_SIZE = 15;
const VOUCHER_PAGE_SIZE = 10;

type DashboardProps = {
  searchParams: Promise<{ page?: string; vpage?: string; from?: string; to?: string; mode?: string }>;
};

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const session = await requireDashboardSession();
  const params = await searchParams;
  const currentPage = Math.max(1, Number(params.page) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;

  // Voucher usage pagination
  const voucherPage = Math.max(1, Number(params.vpage) || 1);
  const voucherOffset = (voucherPage - 1) * VOUCHER_PAGE_SIZE;

  // Date range filter
  const { from: fromDate, to: toDate, isDefaultMonth, hasFilter } = resolveDateRange(
    params.from,
    params.to,
    params.mode
  );
  const { fromIso, toIso } = toIsoRange(fromDate, toDate);

  const supabase = await db();
  const isSuperuser = session.role === "superuser";
  const boothIdStr = !isSuperuser && session.boothId !== null ? String(session.boothId) : null;

  // Build query — filter by boothid (text) for user role
  let dataQuery = supabase
    .from("memento")
    .select("created_at, revenue, boothid", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (boothIdStr) {
    dataQuery = dataQuery.eq("boothid", boothIdStr);
  }

  if (fromIso) dataQuery = dataQuery.gte("created_at", fromIso);
  if (toIso) dataQuery = dataQuery.lte("created_at", toIso);

  let voucherDataQuery = supabase
    .from("voucher_usage")
    .select("id, created_at, voucher_id, memento_uuid, boothid", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(voucherOffset, voucherOffset + VOUCHER_PAGE_SIZE - 1);

  if (boothIdStr) {
    voucherDataQuery = voucherDataQuery.eq("boothid", boothIdStr);
  }

  if (fromIso) voucherDataQuery = voucherDataQuery.gte("created_at", fromIso);
  if (toIso) voucherDataQuery = voucherDataQuery.lte("created_at", toIso);

  const summaryQuery = supabase.rpc("dashboard_memento_summary", {
    p_booth_id: boothIdStr,
    p_from: fromIso,
    p_to: toIso,
  });

  const [dataResult, summaryResult, vDataResult] =
    await Promise.all([
      dataQuery,
      summaryQuery,
      voucherDataQuery,
    ]);

  const summaryRow = Array.isArray(summaryResult.data) ? summaryResult.data[0] : null;
  const totalRows = Number(summaryRow?.total_prints ?? dataResult.count ?? 0);
  const rows = (dataResult.data ?? []) as { created_at: string; revenue: string; boothid: string }[];
  const totalRevenue = Number(summaryRow?.total_revenue ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  // Voucher usage results
  const voucherTotalRows = vDataResult.count ?? 0;
  type VoucherUsageRow = {
    id: string;
    created_at: string;
    voucher_id: string;
    memento_uuid: string;
    boothid: string;
  };
  const voucherRows = (vDataResult.data ?? []) as VoucherUsageRow[];
  const voucherTotalPages = Math.max(1, Math.ceil(voucherTotalRows / VOUCHER_PAGE_SIZE));

  // Fetch voucher names for the usage rows
  const voucherIds = [...new Set(voucherRows.map((r) => r.voucher_id))];
  let voucherNameMap: Record<string, string> = {};
  if (voucherIds.length > 0) {
    const { data: vouchers } = await supabase
      .from("voucher")
      .select("id, name, code")
      .in("id", voucherIds);
    for (const v of vouchers ?? []) {
      voucherNameMap[v.id] = `${v.name} (${v.code})`;
    }
  }

  // Fetch booth names for the transaction rows
  const boothIds = [...new Set(rows.map((r) => r.boothid))];
  let boothNameMap: Record<string, string> = {};
  if (boothIds.length > 0) {
    const { data: booths } = await supabase
      .from("booth")
      .select("id, name")
      .in("id", boothIds.map(Number));
    for (const b of booths ?? []) {
      boothNameMap[String(b.id)] = b.name || `Booth ${b.id}`;
    }
  }

  return (
    <DashboardShell session={session} active="home">
      <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-5">
        <h1 className="text-2xl font-bold">
          {isSuperuser ? "Pusat Kendali Utama" : (session.boothName || "Dashboard Booth")}
        </h1>
        <p className="mt-1 text-sm text-slate-300">
          {isSuperuser
            ? "Ringkasan total print dan revenue seluruh booth."
            : "Ringkasan transaksi booth ini."}
        </p>
      </header>

      {/* ── Date Range Filter ─────────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Filter Periode</h3>
            {hasFilter ? (
              <p className="mt-1 text-xs text-indigo-300">
                {isDefaultMonth
                  ? `Bulan ini · ${formatDateGmt7(fromDate, { dateStyle: "medium" })} — ${formatDateGmt7(toDate, { dateStyle: "medium" })}`
                  : fromDate && toDate
                  ? `${formatDateGmt7(fromDate, { dateStyle: "medium" })} — ${formatDateGmt7(toDate, { dateStyle: "medium" })}`
                  : fromDate
                    ? `Dari ${formatDateGmt7(fromDate, { dateStyle: "medium" })}`
                    : `Sampai ${formatDateGmt7(toDate, { dateStyle: "medium" })}`}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Semua waktu</p>
            )}
          </div>
        </div>
        <div className="mt-3">
          <DateRangeFilter initialFrom={fromDate} initialTo={toDate} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className={`rounded-2xl border p-4 ${hasFilter ? "border-indigo-500/40 bg-indigo-500/5" : "border-slate-800 bg-slate-900/70"}`}>
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-400">Total Print</p>
            {hasFilter ? (
              <span className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                {isDefaultMonth ? "Bulan Ini" : "Filtered"}
              </span>
            ) : null}
          </div>
          <h2 className="mt-2 text-3xl font-bold">{totalRows.toLocaleString("id-ID")}</h2>
        </article>

        <article className={`rounded-2xl border p-4 ${hasFilter ? "border-indigo-500/40 bg-indigo-500/5" : "border-slate-800 bg-slate-900/70"}`}>
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-400">Total Revenue</p>
            {hasFilter ? (
              <span className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                {isDefaultMonth ? "Bulan Ini" : "Filtered"}
              </span>
            ) : null}
          </div>
          <h2 className="mt-2 text-3xl font-bold">{currency(totalRevenue)}</h2>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Riwayat Transaksi</h3>
          <DownloadXlsButton
            boothId={isSuperuser ? null : session.boothId}
            fromDate={fromDate}
            toDate={toDate}
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
                <th className="pb-2 pr-4">Timestamp</th>
                <th className="pb-2 pr-4">Revenue</th>
                <th className="pb-2">Booth</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500">
                    Belum ada data transaksi.
                  </td>
                </tr>
              ) : null}
              {rows.map((row, i) => (
                <tr key={`${row.created_at}-${i}`} className="border-b border-slate-800/50">
                  <td className="py-2 pr-4">
                    {formatDateTimeGmt7(row.created_at, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="py-2 pr-4 font-medium">{currency(Number(row.revenue) || 0)}</td>
                  <td className="py-2 text-slate-300">
                    {isSuperuser
                      ? (boothNameMap[row.boothid] || `Booth ${row.boothid}`)
                      : (session.boothName || `Booth ${row.boothid}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {currentPage > 1 ? (
              <Link
                href={`/dashboard?page=${currentPage - 1}${voucherPage > 1 ? `&vpage=${voucherPage}` : ""}${fromDate ? `&from=${fromDate}` : ""}${toDate ? `&to=${toDate}` : ""}${params.mode === "all" ? "&mode=all" : ""}`}
                className="rounded-lg border border-slate-700 px-3 py-1 hover:bg-slate-800"
              >
                ← Prev
              </Link>
            ) : (
              <span className="rounded-lg border border-slate-800 px-3 py-1 text-slate-600">← Prev</span>
            )}

            <span className="text-slate-400">
              Hal {currentPage} / {totalPages}
            </span>

            {currentPage < totalPages ? (
              <Link
                href={`/dashboard?page=${currentPage + 1}${voucherPage > 1 ? `&vpage=${voucherPage}` : ""}${fromDate ? `&from=${fromDate}` : ""}${toDate ? `&to=${toDate}` : ""}${params.mode === "all" ? "&mode=all" : ""}`}
                className="rounded-lg border border-slate-700 px-3 py-1 hover:bg-slate-800"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded-lg border border-slate-800 px-3 py-1 text-slate-600">Next →</span>
            )}
          </div>
        ) : null}
      </section>

      {/* ── Voucher Usage Table ─────────────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h3 className="text-lg font-semibold">Riwayat Penggunaan Voucher</h3>
        <p className="mt-1 text-xs text-slate-400">
          Total penggunaan: {voucherTotalRows.toLocaleString("id-ID")}
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
                <th className="pb-2 pr-4">No</th>
                <th className="pb-2 pr-4">Timestamp</th>
                <th className="pb-2 pr-4">Voucher</th>
                <th className="pb-2 pr-4">Transaction ID</th>
                {isSuperuser ? <th className="pb-2">Booth</th> : null}
              </tr>
            </thead>
            <tbody>
              {voucherRows.length === 0 ? (
                <tr>
                  <td colSpan={isSuperuser ? 5 : 4} className="py-6 text-center text-slate-500">
                    Belum ada data penggunaan voucher.
                  </td>
                </tr>
              ) : null}
              {voucherRows.map((row, i) => (
                <tr key={row.id} className="border-b border-slate-800/50">
                  <td className="py-2 pr-4 text-slate-400">{voucherOffset + i + 1}</td>
                  <td className="py-2 pr-4">
                    {formatDateTimeGmt7(row.created_at, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="py-2 pr-4">{voucherNameMap[row.voucher_id] || row.voucher_id}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-400">
                    {row.memento_uuid.slice(0, 8)}…
                  </td>
                  {isSuperuser ? <td className="py-2">{row.boothid}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {voucherTotalPages > 1 ? (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {voucherPage > 1 ? (
              <Link
                href={`/dashboard?page=${currentPage}&vpage=${voucherPage - 1}${fromDate ? `&from=${fromDate}` : ""}${toDate ? `&to=${toDate}` : ""}${params.mode === "all" ? "&mode=all" : ""}`}
                className="rounded-lg border border-slate-700 px-3 py-1 hover:bg-slate-800"
              >
                ← Prev
              </Link>
            ) : (
              <span className="rounded-lg border border-slate-800 px-3 py-1 text-slate-600">← Prev</span>
            )}

            <span className="text-slate-400">
              Hal {voucherPage} / {voucherTotalPages}
            </span>

            {voucherPage < voucherTotalPages ? (
              <Link
                href={`/dashboard?page=${currentPage}&vpage=${voucherPage + 1}${fromDate ? `&from=${fromDate}` : ""}${toDate ? `&to=${toDate}` : ""}${params.mode === "all" ? "&mode=all" : ""}`}
                className="rounded-lg border border-slate-700 px-3 py-1 hover:bg-slate-800"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded-lg border border-slate-800 px-3 py-1 text-slate-600">Next →</span>
            )}
          </div>
        ) : null}
      </section>
    </DashboardShell>
  );
}
