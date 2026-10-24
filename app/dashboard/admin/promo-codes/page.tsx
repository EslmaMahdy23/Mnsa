import Link from "next/link";
import CoursePromoCodesManager from "@/components/admin/CoursePromoCodesManager";

export default function AdminPromoCodesPage() {
  return <><Link href="/dashboard/admin" className="adm-back">← لوحة الأدمن</Link><CoursePromoCodesManager /></>;
}
