import Link from "next/link";
import StudentDashboardManager from "@/components/admin/StudentDashboardManager";

export default function AdminStudentDashboardPage() {
  return (
    <>
      <div className="admin-course-heading">
        <Link href="/dashboard/admin" className="btn btn-outline btn-sm">
          <i className="fa-solid fa-arrow-right" /> رجوع للوحة الأدمن
        </Link>
      </div>
      <StudentDashboardManager />
    </>
  );
}
