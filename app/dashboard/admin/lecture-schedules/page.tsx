import Link from "next/link";
import LectureSchedulesManager from "@/components/admin/LectureSchedulesManager";

export default function AdminLectureSchedulesPage() {
  return (
    <>
      <div className="admin-course-heading">
        <Link href="/dashboard/admin" className="btn btn-outline btn-sm">
          <i className="fa-solid fa-arrow-right" /> رجوع للوحة الأدمن
        </Link>
      </div>
      <LectureSchedulesManager />
    </>
  );
}
