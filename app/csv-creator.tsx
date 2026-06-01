import { db } from "@/utils/supabase/server";
import { Memento } from "./memento/types";
import { env } from "./env";
import { toGmt7OffsetISOString } from "@/app/lib/timezone";

export async function getAllMemento(): Promise<Memento[]> {
    const supabase = await db();
    const { data, error } = await supabase.from("memento").select("*");
    if (error) throw error;
    return data;
}

export function yesterday() {
    const dt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return toGmt7OffsetISOString(dt);
}

export async function getAllMementoYesterday() {
    const supabase = await db();
    const { data, error } = await supabase.from("memento").select("*").gt("created_at", yesterday());
    console.log(error);
    if (error) throw error;
    return data;
}

function ensureNumber(value: any): number {
    try {
        const num = parseInt(value);
        if (isNaN(num)) {
            return env.midtransPrice ? parseInt(env.midtransPrice) : 38001;
        }
    } catch (e) {
        return env.midtransPrice ? parseInt(env.midtransPrice) : 38001;
    }
    return env.midtransPrice ? parseInt(env.midtransPrice) : 38001;;
}

export async function createCSVStr(data: Memento[]) {
    // uuid,created_at,updated_at,additional,revenue
    let csvContent = "uuid,created_at,updated_at,additional,revenue\n";
    let totalRevenue = 0;
    let count = 0;
    for(const row of data) {
        const revenue = ensureNumber(row.revenue);
        csvContent += `${row.uuid},${row.created_at},${row.updated_at},${row.additional},${revenue}\n`;
        totalRevenue += revenue;
        count++;
    }
    csvContent += `,,,,\n`;
    csvContent += `Customer Total,,,,Revenue Total\n`;
    csvContent += `${count},,,,${totalRevenue}\n`;

    return csvContent;
}
