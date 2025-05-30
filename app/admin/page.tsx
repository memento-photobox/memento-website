"use client";
import Image from "next/image";

import { FormEvent, FormEventHandler, useState } from "react";

function downloadFile(blob: Blob, name = "file.pdf") {
    const href = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href,
      style: "display:none",
      download: name,
    });
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(href);
    a.remove();
  }

export default function Admin() {
    const [error, setError] = useState("");
    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const form = e.currentTarget;
        const formData = new FormData(form);

        const res = await fetch("/admin/report", {
            method: "POST",
            body: formData
        })
        if(!res.ok) {
            // res.json().then(json => console.log(json.error)).catch(e => setError("Unknown error"));
            const json = await res.json();
            console.log(json);
            return;
        }
        const blob = await res.blob();
        downloadFile(blob, "report.csv");
    }

    return <>
<div className="fixed bg-zinc-950 -z-50 w-screen h-dvh h-vh"></div>
<div className="fixed w-screen h-dvh h-vh flex justify-center items-center">
    <div className="bg-zinc-900 p-8 rounded-2xl flex flex-col w-full max-w-72 mx-4">
        <h1 className="w-full text-center font-bold text-xl">Admin Page</h1>
        <form onSubmit={submit} method="post" className="flex flex-col">
            
            <div className="h-1"></div>
            <label htmlFor="password" className="font-semibold mb-1 text-sm">Password</label>
            <div className="w-full flex relative items-center">
                <input type="password" id="password" name="password" className="cursor-text rounded-xl pl-12 bg-zinc-900 text-slate-50 outline-none ring-1 ring-zinc-700 hover:ring-1 hover:ring-indigo-700 focus:ring-indigo-700 focus:bg-zinc-800 ring-inset h-10 w-full"/>
                <Image alt="password icon" width={50} height={50} src="https://api.iconify.design/mdi/password.svg?color=%23aaaaaa" className="absolute w-4 ml-4"/>
            </div>
            
            <div className="h-4"></div>
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 active:ring-4 focus:ring-4 ring-blue-800 text-slate-50 px-2 w-full py-1 rounded-xl cursor-pointer font-semibold flex items-center justify-center h-10">Submit</button>
        </form>
        {error && <div className="mt-2 text-red-500">Error: {error}</div>}
    </div>
</div>
</>
}