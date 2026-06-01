import { NextRequest, NextResponse } from "next/server";
import { getDashboardSession } from "../auth";
import { db } from "@/utils/supabase/server";
import { formatDateTimeGmt7, toGmt7DayEndISOString, toGmt7DayStartISOString } from "@/app/lib/timezone";

// Supabase/PostgREST commonly caps response rows per request at 1000 by default.
// Keep chunk size at 1000 so pagination can reliably fetch all rows.
const EXPORT_BATCH_SIZE = 1000;

type ExportRow = {
  created_at: string;
  revenue: string;
  boothid: string;
};

export async function GET(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const boothId = url.searchParams.get("boothId");
  const fromDate = url.searchParams.get("from");
  const toDate = url.searchParams.get("to");

  const supabase = await db();

  const rows: ExportRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("memento")
      .select("created_at, revenue, boothid")
      .order("created_at", { ascending: false })
      .range(offset, offset + EXPORT_BATCH_SIZE - 1);

    // User role can only export their own booth
    if (session.role !== "superuser" && session.boothId !== null) {
      query = query.eq("boothid", String(session.boothId));
    } else if (boothId) {
      query = query.eq("boothid", boothId);
    }

    if (fromDate) {
      query = query.gte("created_at", toGmt7DayStartISOString(fromDate));
    }
    if (toDate) {
      query = query.lte("created_at", toGmt7DayEndISOString(toDate));
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const batch = (data ?? []) as ExportRow[];
    rows.push(...batch);

    if (batch.length < EXPORT_BATCH_SIZE) break;
    offset += EXPORT_BATCH_SIZE;
  }

  // Build XLS-compatible HTML table (Excel can open this)
  const header = `<tr><th>No</th><th>Timestamp</th><th>Revenue</th><th>Booth ID</th></tr>`;
  const body = rows
    .map(
      (row, i: number) =>
        `<tr><td>${i + 1}</td><td>${formatDateTimeGmt7(row.created_at)}</td><td>${row.revenue}</td><td>${row.boothid}</td></tr>`
    )
    .join("");

  const totalRevenue = rows.reduce(
    (sum: number, r) => sum + (Number(r.revenue) || 0),
    0
  );

  const footer = `<tr><td colspan="2"><strong>TOTAL</strong></td><td><strong>${totalRevenue}</strong></td><td></td></tr>`;

  const xls = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="UTF-8"></head>
    <body>
      <table border="1">
        <thead>${header}</thead>
        <tbody>${body}</tbody>
        <tfoot>${footer}</tfoot>
      </table>
    </body>
    </html>
  `;

  return new NextResponse(xls, {
    headers: {
      "Content-Type": "application/vnd.ms-excel",
      "Content-Disposition": `attachment; filename="laporan.xls"`,
    },
  });
}
