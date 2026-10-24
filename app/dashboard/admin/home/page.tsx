import Link from "next/link";
import HomeContentManager from "@/components/admin/HomeContentManager";

export default function AdminHomeContentPage() {
  return (
    <>
      <div className="admin-course-heading">
        <Link href="/dashboard/admin" className="btn btn-outline btn-sm">
          <i className="fa-solid fa-arrow-right" /> رجوع للوحة الأدمن
        </Link>
      </div>
      <HomeContentManager />
    </>
  );
}
