type CourseContentSummaryProps = {
  files: number;
  exams: number;
  videos: number;
  sections: number;
};

const numberFormat = new Intl.NumberFormat("en-US");

export default function CourseContentSummary({ files, exams, videos, sections }: CourseContentSummaryProps) {
  const items = [
    { label: "ملفات", count: files, icon: "fa-file-lines", color: "files" },
    { label: "أقسام", count: sections, icon: "fa-layer-group", color: "sections" },
    { label: "امتحانات", count: exams, icon: "fa-clipboard-list", color: "exams" },
    { label: "فيديوهات", count: videos, icon: "fa-circle-play", color: "videos" },
  ].filter((item) => item.count > 0);

  if (items.length === 0) return null;

  return (
    <div className="course-content-summary" aria-label="محتويات الكورس الفعلية">
      {items.map((item) => (
        <div className={`course-content-stat ${item.color}`} key={item.color}>
          <span>{item.label}</span>
          <b><i className={`fa-solid ${item.icon}`} aria-hidden="true" />{numberFormat.format(item.count)}</b>
        </div>
      ))}
    </div>
  );
}
