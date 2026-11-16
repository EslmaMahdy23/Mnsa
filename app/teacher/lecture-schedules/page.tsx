import TeacherLectureSchedules from "@/components/teacher/TeacherLectureSchedules";

export default function TeacherLectureSchedulesPage({ searchParams }: { searchParams: { course?: string } }) {
  return <TeacherLectureSchedules initialCourseId={searchParams.course ?? ""} />;
}
