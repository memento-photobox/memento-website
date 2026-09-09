import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Yokke QR Sandbox | Memento Internal",
    description: "Internal sandbox for Yokke QRIS test cases",
    robots: { index: false, follow: false },
};

export default function InternalLayout({ children }: { children: React.ReactNode }) {
    return children;
}
