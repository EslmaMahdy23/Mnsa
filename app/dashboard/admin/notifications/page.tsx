import Link from "next/link";
import AdminNotificationComposer from "@/components/admin/AdminNotificationComposer";

export default function AdminNotificationsPage() {
  return (
    <>
      <div className="adm-head">
        <Link href="/dashboard/admin" className="btn btn-outline btn-sm"><i className="fa-solid fa-arrow-right" /> رجوع للوحة الأدمن</Link>
      </div>
      <AdminNotificationComposer />
    </>
  );
}
