import Link from "next/link";
import WalletCardsManager from "@/components/admin/WalletCardsManager";

export default function AdminWalletCardsPage() {
  return <><Link href="/dashboard/admin" className="adm-back">← لوحة الأدمن</Link><WalletCardsManager /></>;
}
