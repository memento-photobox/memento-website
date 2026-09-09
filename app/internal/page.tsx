import { getSandboxDefaults } from "./lib/yokke";
import YokkeSandbox from "./_components/yokke-sandbox";

export const dynamic = "force-dynamic";

export default function InternalPage() {
    return <YokkeSandbox defaults={getSandboxDefaults()} />;
}
