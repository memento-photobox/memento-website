import { Memento } from "@/app/memento/types";
import { db } from "@/utils/supabase/server";
import { formatDateTimeGmt7 } from "@/app/lib/timezone";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";


function formatDate(date: string): string {
    return formatDateTimeGmt7(date, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

async function togglePaid(formData: FormData) {
    "use server";

    
    if(!await isRequestFromAdmin()) {
        redirect("/admin/login");
    }

    const uuid = formData.get("uuid") as string;
    const is_paid = formData.get("is_paid") as string;
    if (!uuid) return;
    if (!is_paid) return;

    const isPaid = is_paid === "true";
    const memento = await setPaid(uuid, !isPaid);
    
    redirect("/admin/memento");

}

async function isRequestFromAdmin() {
    const cookieStore = cookies();
    const token = (await cookieStore).get('token');
    if(token && token.value === process.env.BASIC_AUTH_SECRET) {
        return true;
    } 
    return false;
}

export default async function PaymentPage() {
    if(!await isRequestFromAdmin()) {
        redirect("/admin/login");
    }

    const mementos = await getAllMemento();
    if (!mementos) return <div>Error</div>;
    if (mementos.length === 0) return <div>None</div>;

    function generateRows(mementos: Memento[]) {
        return mementos.map((memento, idx) => <tr key={idx} className="bg-slate-900">
        <td className="flex justify-center items-center">
            <div className="flex items-center mb-4">
                <form action={togglePaid} method="post">
                    <input type="hidden" value={memento.uuid} name="uuid"/>
                    <input type="hidden" value={memento.is_paid + ""} name="is_paid"/>
                    <button className={"w-5 h-5 hover:ring-4 ring-opacity-75 translate-y-2.5 ring-blue-500 focus:ring-blue-600 ring-offset-gray-800 rounded-md border-gray-600 text-white " + (memento.is_paid ? "bg-blue-500" : "bg-gray-700")}>
                        {memento.is_paid ? <>
                            <svg className="-translate-x-0.5 -translate-y-0.5 scale-75" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="m9 20.42l-6.21-6.21l2.83-2.83L9 14.77l9.88-9.89l2.83 2.83z"/></svg>
                        </> : <></>}    
                    </button>
                </form>
            </div>
        </td>
        <td className="px-2">{formatDate(memento.created_at)}</td>
        <td className="px-2">{formatDate(memento.updated_at)}</td>
        <td className="px-2">{memento.revenue}</td>
        <td className="px-2">{memento.uuid}</td>
        <td className="px-2">{memento.medias == null ? "" : "Done"}</td>
        </tr>);
    }

    return <>
<table className="w-full text-sm text-left rtl:text-right text-slate-50">
  <thead className="bg-gray-700 text-gray-400">
    <tr>
      <th className="w-24">Is Paid</th>
      <th className="w-12">Created At</th>
      <th className="w-12">Updated At</th>
      <th className="w-12">Revenue</th>
      <th className="w-80">UUID</th>
      <th className="w-80">Medias</th>
    </tr>
  </thead>
  <tbody className="border-bbg-gray-800 border-gray-200">
    {generateRows(mementos)}
  </tbody>
</table>

</>
}


async function setPaid(uuid: string, is_paid: boolean): Promise<Memento | null> {
    const supabase = await db();
    const { data, error } = await supabase
        .from("memento")
        .update({ is_paid: is_paid, updated_at: new Date() })
        .eq("uuid", uuid)
        .select("*")
        .single()
    if (error) throw error;
    return data;
}

async function getAllMemento(): Promise<Memento[] | null> {
    const supabase = await db();
    const { data, error } = await supabase
        .from("memento")
        .select("*")
        .order("created_at", { ascending: false })
    return data;
}