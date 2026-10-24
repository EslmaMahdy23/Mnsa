"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "@/components/dashboard/ProfileContext";
import "@/app/auth.css";
import "./admin.css";

// حارس الواجهة يسمح للأدمن وبوكلاء المهام بصفحات عملهم فقط؛ الحماية الأساسية في قاعدة البيانات.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const p = useProfile();
  const router = useRouter();
  const pathname = usePathname();
  const isAdmin = p.role === "admin";
  const isCourseManager = p.role === "course_manager";
  const isForumModerator = p.role === "forum_moderator";
  const isPaymentManager = p.role === "payment_manager";
  const isSupportAgent = p.role === "support_agent";
  const canManageCoursePath = pathname === "/dashboard/admin/courses"
    || pathname.startsWith("/dashboard/admin/courses/")
    || pathname === "/dashboard/admin/exams/new"
    || /^\/dashboard\/admin\/exams\/[^/]+$/.test(pathname);
  const canEnter = isAdmin || (isCourseManager && canManageCoursePath)
    || (isForumModerator && pathname === "/dashboard/admin/forum")
    || (isPaymentManager && pathname === "/dashboard/admin/topups")
    || (isSupportAgent && pathname === "/dashboard/admin/support");

  useEffect(() => {
    if (canEnter) return;
    const destination = isCourseManager ? "/dashboard/admin/courses"
      : isForumModerator ? "/dashboard/admin/forum"
        : isPaymentManager ? "/dashboard/admin/topups"
          : isSupportAgent ? "/dashboard/admin/support" : "/dashboard";
    router.replace(destination);
  }, [canEnter, isCourseManager, isForumModerator, isPaymentManager, isSupportAgent, router]);

  if (!canEnter) return null;
  return <>{children}</>;
}
