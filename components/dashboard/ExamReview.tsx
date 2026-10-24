"use client";

import "@/app/dashboard/exams/exams.css";

// مراجعة الامتحان بعد التسليم (بيانات دالة get_exam_review).
// في وضع marks مفيش correct_index ولا explanation، وفي full فيهم.
export type ReviewQ = {
  body: string;
  options: string[];
  points: number;
  my_index: number | null;
  is_correct: boolean;
  correct_index?: number;
  explanation?: string | null;
};
export type EssayReviewQ = { body: string; answer: string | null; points: number; score: number | null; feedback: string | null };
export type Review = { mode: "none" | "marks" | "full" | "pending"; essay_pending?: boolean; questions?: ReviewQ[]; essays?: EssayReviewQ[] };

// الألوان:
//  أخضر = إجابتك صح | أحمر = إجابتك غلط | أزرق = الإجابة الصح (لما إجابتك تبقى غلط، في وضع full بس)
//  وتحت كل سؤال "ليه دي الإجابة الصح؟" لو الأدمن كتب شرح (وضع full بس)
export default function ReviewList({ mode, questions, essays = [] }: { mode: "none" | "marks" | "full"; questions: ReviewQ[]; essays?: EssayReviewQ[] }) {
  const right = questions.filter((q) => q.is_correct).length;
  return (
    <section aria-label="مراجعة الإجابات">
      {(mode !== "none" && questions.length > 0) && <h2 className="ex-rv-title">
        مراجعة إجاباتك · {right.toLocaleString("ar-EG")} من {questions.length.toLocaleString("ar-EG")} صح
      </h2>}
      {questions.map((q, qi) => {
        const unanswered = q.my_index === null || q.my_index === undefined;
        return (
          <div className="ex-q" key={qi}>
            <div className="ex-q-head">
              <span className="ex-q-no">{(qi + 1).toLocaleString("ar-EG")}</span>
              <div className="ex-q-body">{q.body}</div>
              {unanswered && <span className="ex-badge open">من غير إجابة</span>}
            </div>
            {q.options.map((o, oi) => {
              const mine = q.my_index === oi;
              const isRight = mode === "full" && q.correct_index === oi;
              // إجابتي: أخضر لو صح وأحمر لو غلط. الإجابة الصح لو مش إجابتي: أزرق
              const cls = mine ? (q.is_correct ? " good" : " bad") : isRight ? " good" : "";
              const label = mine
                ? q.is_correct
                  ? "إجابتك · الإجابة الصحيحة"
                  : "إجابتك"
                : isRight
                  ? "الإجابة الصحيحة"
                  : "";
              return (
                <div className={`ex-rv-opt${cls}`} key={oi}>
                  <span>{o}</span>
                  {label && <small>{label}</small>}
                </div>
              );
            })}
            {mode === "full" && q.explanation && (
              <div className="ex-rv-expl">
                <b>ليه دي الإجابة الصح؟</b> {q.explanation}
              </div>
            )}
          </div>
        );
      })}
      {essays.map((q, qi) => <div className="ex-q" key={"essay-" + qi}>
        <div className="ex-q-head"><span className="ex-q-no">مقالي</span><div className="ex-q-body">{q.body}</div><span className="ex-badge pass">{(q.score ?? 0).toLocaleString("ar-EG")} / {q.points.toLocaleString("ar-EG")}</span></div>
        <p><b>إجابتك:</b></p><div style={{ whiteSpace: "pre-wrap" }}>{q.answer || "بدون إجابة"}</div>
        {q.feedback && <div className="ex-rv-expl"><b>ملاحظة المدرّس:</b> {q.feedback}</div>}
      </div>)}
    </section>
  );
}
