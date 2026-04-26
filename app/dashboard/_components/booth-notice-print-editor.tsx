"use client";

import { useState } from "react";
import { updateBoothNoticePrintAction } from "@/app/dashboard/actions";

export default function BoothNoticePrintEditor({
  boothId,
  currentNoticePrint,
}: {
  boothId: number;
  currentNoticePrint: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentNoticePrint !== null ? String(currentNoticePrint) : "");

  // Enforce only non-negative integers while typing
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Strip non-digit characters; allow empty string to clear
    if (raw === "" || /^\d+$/.test(raw)) {
      setValue(raw);
    }
  }

  if (!editing) {
    return (
      <div>
        {currentNoticePrint !== null ? (
          <p className="mt-1 text-xl font-bold">
            {currentNoticePrint.toLocaleString("id-ID")}{" "}
            <span className="text-sm font-normal text-slate-400">print/bulan</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">Belum diset</p>
        )}
        <button
          onClick={() => setEditing(true)}
          className="mt-3 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold hover:bg-indigo-400 transition-colors"
        >
          Set Notice Print
        </button>
      </div>
    );
  }

  return (
    <form action={updateBoothNoticePrintAction} className="mt-2 space-y-3">
      <input type="hidden" name="booth_id" value={boothId} />
      <div>
        <label htmlFor={`notice-print-${boothId}`} className="text-xs text-slate-400">
          Jumlah print per bulan (kosongkan untuk hapus)
        </label>
        <input
          id={`notice-print-${boothId}`}
          name="notice_print"
          type="text"
          inputMode="numeric"
          pattern="\d*"
          min={1}
          value={value}
          onChange={handleChange}
          placeholder="cth: 660"
          className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          autoFocus
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Hanya angka bulat positif. Email akan terkirim ke memento.photobox saat total print bulan ini mencapai nilai ini.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold hover:bg-indigo-400 transition-colors"
        >
          Simpan
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue(currentNoticePrint !== null ? String(currentNoticePrint) : "");
          }}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-800 transition-colors"
        >
          Batal
        </button>
      </div>
    </form>
  );
}
