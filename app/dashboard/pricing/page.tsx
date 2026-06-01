import DashboardShell from "../_components/dashboard-shell";
import { requireDashboardSession } from "../auth";
import { currency } from "../mock-data";
import { db } from "@/utils/supabase/server";
import PriceEditor from "@/app/dashboard/_components/price-editor";
import VoucherModal from "@/app/dashboard/_components/voucher-modal";
import DeleteVoucherButton from "@/app/dashboard/_components/delete-voucher-button";
import { formatDateTimeGmt7 } from "@/app/lib/timezone";

type Voucher = {
  id: string;
  created_at: string;
  name: string;
  code: string;
  discount_type: "percentage" | "nominal";
  discount_value: number;
  max_usage: number;
  current_usage: number;
  expires_at: string;
  allowed_booth_ids: number[];
};

type Booth = {
  id: number;
  name: string | null;
};

export default async function DashboardPricingPage() {
  const session = await requireDashboardSession();
  if (session.role !== "superuser") {
    return (
      <DashboardShell session={session} active="pricing">
        <p className="text-slate-400">Akses hanya untuk superuser.</p>
      </DashboardShell>
    );
  }

  const supabase = await db();

  // Fetch the first booth's price as the "global" price (all booths share the same price after update)
  const { data: boothRow } = await supabase
    .from("booth")
    .select("price")
    .order("id", { ascending: true })
    .limit(1)
    .single();

  const globalPrice = boothRow?.price ?? 0;

  const { data: boothRows } = await supabase
    .from("booth")
    .select("id, name")
    .order("id", { ascending: true });

  const booths = (boothRows ?? []) as Booth[];
  const boothNameMap = Object.fromEntries(
    booths.map((b) => [b.id, b.name || `Booth ${b.id}`])
  ) as Record<number, string>;

  // Fetch all vouchers
  const { data: vouchers } = await supabase
    .from("voucher")
    .select("*")
    .order("created_at", { ascending: false });

  const voucherList = (vouchers ?? []) as Voucher[];

  return (
    <DashboardShell session={session} active="pricing">
      <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:p-5">
        <h1 className="text-2xl font-bold">Pricing & Voucher</h1>
        <p className="mt-1 text-sm text-slate-300">
          Set harga global untuk semua booth dan kelola voucher diskon.
        </p>
      </header>

      {/* ── Global Price Card ─────────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <p className="text-xs text-slate-400">Harga Global (berlaku semua booth)</p>
        <PriceEditor currentPrice={globalPrice} />
      </section>

      {/* ── Voucher List ──────────────────────────── */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Daftar Voucher</h3>
            <p className="text-xs text-slate-400">
              {voucherList.length} voucher terdaftar
            </p>
          </div>
          <VoucherModal booths={booths} />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
                <th className="pb-2 pr-4">Nama</th>
                <th className="pb-2 pr-4">Kode</th>
                <th className="pb-2 pr-4">Diskon</th>
                <th className="pb-2 pr-4">Penggunaan</th>
                <th className="pb-2 pr-4">Berlaku Sampai</th>
                <th className="pb-2 pr-4">Booth Berlaku</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {voucherList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    Belum ada voucher. Klik &quot;+ Buat Voucher&quot; untuk membuat.
                  </td>
                </tr>
              ) : null}
              {voucherList.map((v) => {
                const expired = new Date(v.expires_at) < new Date();
                const maxedOut = v.current_usage >= v.max_usage;
                const isActive = !expired && !maxedOut;

                return (
                  <tr key={v.id} className="border-b border-slate-800/50">
                    <td className="py-2 pr-4 font-medium">{v.name}</td>
                    <td className="py-2 pr-4">
                      <code className="rounded bg-slate-800 px-2 py-0.5 text-xs text-indigo-300">
                        {v.code}
                      </code>
                    </td>
                    <td className="py-2 pr-4">
                      {v.discount_type === "percentage"
                        ? `${v.discount_value}%`
                        : currency(v.discount_value)}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-slate-300">
                        {v.current_usage}
                      </span>
                      <span className="text-slate-500"> / {v.max_usage}</span>
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {formatDateTimeGmt7(v.expires_at, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-2 pr-4">
                      {v.allowed_booth_ids?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {v.allowed_booth_ids.map((id) => (
                            <span
                              key={`${v.id}-${id}`}
                              className="inline-block rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-200"
                            >
                              {boothNameMap[id] || `Booth ${id}`}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {isActive ? (
                        <span className="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                          Aktif
                        </span>
                      ) : expired ? (
                        <span className="inline-block rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300">
                          Expired
                        </span>
                      ) : (
                        <span className="inline-block rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                          Maks. Tercapai
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <DeleteVoucherButton voucherId={v.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </DashboardShell>
  );
}
