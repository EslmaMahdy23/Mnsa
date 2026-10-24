"use client";

import Link from "next/link";
import { useProfile } from "@/components/dashboard/ProfileContext";
import SupportInbox from "@/components/admin/SupportInbox";

export default function AdminSupportPage() {
  const profile = useProfile();
  return <>
    {profile.role === "admin" && <div className="admin-course-heading"><Link href="/dashboard/admin" className="btn btn-outline btn-sm"><i className="fa-solid fa-arrow-right" /> رجوع للوحة الأدمن</Link></div>}
    <SupportInbox />
  </>;
}
