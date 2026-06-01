"use client";

import { toGmt7OffsetISOString } from "@/app/lib/timezone";

type DownloadXlsButtonProps = {
  boothId: string | null;
  fromDate?: string;
  toDate?: string;
};

export default function DownloadXlsButton({ boothId, fromDate, toDate }: DownloadXlsButtonProps) {
  function buildTimestamp() {
    const iso = toGmt7OffsetISOString(new Date(), { includeMilliseconds: false });
    const [date, time] = iso.split("T");
    const [hh, mi, ss] = time.replace("+07:00", "").split(":");
    const [yyyy, mm, dd] = date.split("-");
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  }

  async function handleDownload() {
    const params = new URLSearchParams();
    if (boothId !== null) params.set("boothId", boothId);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    const res = await fetch(`/dashboard/export?${params.toString()}`);
    if (!res.ok) {
      alert("Gagal mengunduh file.");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-${boothId || "all"}-${buildTimestamp()}.xls`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  }

  return (
    <button
      onClick={handleDownload}
      className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      </svg>
      Download XLS
    </button>
  );
}
