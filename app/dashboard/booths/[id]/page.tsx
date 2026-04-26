import Link from "next/link";
import { notFound } from "next/navigation";

import DashboardShell from "../../_components/dashboard-shell";
import { requireDashboardSession } from "../../auth";
import { currency } from "../../mock-data";
import { db } from "@/utils/supabase/server";
import BoothPriceEditor from "@/app/dashboard/_components/booth-price-editor";
import BoothNoticePrintEditor from "@/app/dashboard/_components/booth-notice-print-editor";
import DateRangeFilter from "@/app/dashboard/_components/date-range-filter";
import DownloadXlsButton from "@/app/dashboard/_components/download-xls-button";
import { resolveDateRange, toIsoRange } from "@/app/dashboard/date-range";

const PAGE_SIZE = 15;

type BoothDetailProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; from?: string; to?: string; mode?: string; success?: string; error?: string }>;
};

type VoucherForBooth = {
  id: string;
  name: string;
  code: string;
  discount_type: "percentage" | "nominal";
  discount_value: number;
  current_usage: number;
  max_usage: number;
  expires_at: string;
};

export default async function BoothDetailPage({ params, searchParams }: BoothDetailProps) {
  const session = await requireDashboardSession();
  if (session.role !== "superuser") {
    return (
      <DashboardShell session={session} active="booths">
        <p className="text-slate-400">Akses hanya untuk superuser.</p>
      </DashboardShell>
    );
  }

  const { id } = await params;
  const boothId = Number(id);
  if (Number.isNaN(boothId)) notFound();

  const sp = await searchParams;
  const currentPage = Math.max(1, Number(sp.page) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const { from: fromDate, to: toDate, isDefaultMonth, hasFilter } = resolveDateRange(
    sp.from,
    sp.to,
    sp.mode
  );
  const { fromIso, toIso } = toIsoRange(fromDate, toDate);

  const supabase = await db();

  // Fetch booth info
  const { data: booth, error: boothErr } = await supabase
    .from("booth")
    .select("id, name, price, notice_print")
    .eq("id", boothId)
    .single();

  if (boothErr || !booth) notFound();

  const boothIdStr = String(booth.id);
  const basePath = `/dashboard/booths/${booth.id}`;

  // Build memento queries filtered by this booth
  let dataQuery = supabase
    .from("memento")
    .select("created_at, revenue", { count: "exact" })
    .eq("boothid", boothIdStr)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (fromIso) dataQuery = dataQuery.gte("created_at", fromIso);
  if (toIso) dataQuery = dataQuery.lte("created_at", toIso);

  const summaryQuery = supabase.rpc("dashboard_memento_summary", {
    p_booth_id: boothIdStr,
    p_from: fromIso,
    p_to: toIso,
  });

  const [dataResult, summaryResult] = await Promise.all([
    dataQuery,
    summaryQuery,
  ]);

  const nowIso = new Date().toISOString();
  const { data: voucherRows } = await supabase
    .from("voucher")
    .select("id, name, code, discount_type, discount_value, current_usage, max_usage, expires_at")
    .contains("allowed_booth_ids", [booth.id])
    .gt("expires_at", nowIso)
    .order("expires_at", { ascending: true });

  const activeVouchers = ((voucherRows ?? []) as VoucherForBooth[]).filter(
    (v) => v.current_usage < v.max_usage
  );

  const summaryRow = Array.isArray(summaryResult.data) ? summaryResult.data[0] : null;
  const totalRows = Number(summaryRow?.total_prints ?? dataResult.count ?? 0);
  const rows = (dataResult.data ?? []) as { created_at: string; revenue: string }[];
  const totalRevenue = Number(summaryRow?.total_revenue ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  return (
    <DashboardShell session={session} active="booths">
      {sp.success === "notice" ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Notice print berhasil diperbarui.
        </div>
      ) : sp.success === "price" ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Harga booth berhasil diperbarui.
        </div>
      ) : null}
      {sp.error === "invalid_notice" ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Nilai notice print tidak valid. Masukkan angka bulat positif.
        </div>
      ) : null}

      <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-5">
        <p className="text-xs uppercase tracking-[0.15em] text-indigo-300">Booth Detail</p>
        <h1 className="mt-1 text-2xl font-bold">
          {booth.name || `Booth ${booth.id}`}
        </h1>
        <p className="mt-1 text-sm text-slate-300">
          ID: {booth.id} · Status operasional, pricing booth, dan laporan keuangan lokal.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        {/* ── Status Booth (mock for now) ── */}
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-lg font-semibold">Voucher Aktif Booth Ini</h2>
          <div className="mt-4">
            {activeVouchers.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">Tidak ada voucher aktif.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {activeVouchers.map((voucher) => (
                  <span
                    key={voucher.id}
                    className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-xs text-indigo-200"
                  >
                    <strong>{voucher.code}</strong>
                    <span>·</span>
                    <span>
                      {voucher.discount_type === "percentage"
                        ? `${voucher.discount_value}%`
                        : currency(voucher.discount_value)}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </article>

        {/* ── Pricing Booth ── */}
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-lg font-semibold">Pricing Booth</h2>
          <div className="mt-3">
            <p className="text-xs text-slate-400">Harga Booth Saat Ini</p>
            <BoothPriceEditor boothId={booth.id} currentPrice={booth.price ?? 0} />
          </div>
        </article>
      </section>

      {/* ── Notice Print ──────────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="text-lg font-semibold">Notice Print</h2>
        <p className="mt-1 text-xs text-slate-400">
          Email notifikasi ke memento.photobox saat total print bulan ini mencapai nilai ini.
        </p>
        <div className="mt-3">
          <BoothNoticePrintEditor
            boothId={booth.id}
            currentNoticePrint={(booth as { notice_print?: number | null }).notice_print ?? null}
          />
        </div>
      </section>

      {/* ── Filter Periode ──────────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Filter Periode</h3>
            {hasFilter ? (
              <p className="mt-1 text-xs text-indigo-300">
                {isDefaultMonth
                  ? `${new Date(fromDate).toLocaleDateString("id-ID", { dateStyle: "medium" })} — ${new Date(toDate).toLocaleDateString("id-ID", { dateStyle: "medium" })} · Bulan ini`
                  : fromDate && toDate
                  ? `${new Date(fromDate).toLocaleDateString("id-ID", { dateStyle: "medium" })} — ${new Date(toDate).toLocaleDateString("id-ID", { dateStyle: "medium" })}`
                  : fromDate
                    ? `Dari ${new Date(fromDate).toLocaleDateString("id-ID", { dateStyle: "medium" })}`
                    : `Sampai ${new Date(toDate).toLocaleDateString("id-ID", { dateStyle: "medium" })}`}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Semua waktu</p>
            )}
          </div>
        </div>
        <div className="mt-3">
          <DateRangeFilter basePath={basePath} initialFrom={fromDate} initialTo={toDate} />
        </div>
      </section>

      {/* ── Laporan Keuangan & Inventory ──────── */}
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

      {/* ── Riwayat Transaksi ────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Riwayat Transaksi</h3>
          <DownloadXlsButton boothId={boothIdStr} fromDate={fromDate} toDate={toDate} />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
                <th className="pb-2 pr-4">Timestamp</th>
                <th className="pb-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-6 text-center text-slate-500">
                    Belum ada data transaksi.
                  </td>
                </tr>
              ) : null}
              {rows.map((row, i) => (
                <tr key={`${row.created_at}-${i}`} className="border-b border-slate-800/50">
                  <td className="py-2 pr-4">
                    {new Date(row.created_at).toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="py-2 font-medium">{currency(Number(row.revenue) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {currentPage > 1 ? (
              <Link
                href={`${basePath}?page=${currentPage - 1}${fromDate ? `&from=${fromDate}` : ""}${toDate ? `&to=${toDate}` : ""}${sp.mode === "all" ? "&mode=all" : ""}`}
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
                href={`${basePath}?page=${currentPage + 1}${fromDate ? `&from=${fromDate}` : ""}${toDate ? `&to=${toDate}` : ""}${sp.mode === "all" ? "&mode=all" : ""}`}
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

      <div>
        <Link href="/dashboard/booths" className="text-sm text-indigo-300 hover:text-indigo-200">
          ← Kembali ke daftar booth
        </Link>
      </div>
    </DashboardShell>
  );
}
