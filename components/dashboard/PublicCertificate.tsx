"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import "./certificates.css";

async function downloadCertificatePdf() {
  const art = document.querySelector<HTMLElement>(".certificate-art");
  const source = art?.querySelector("img");
  const name = art?.querySelector<HTMLElement>(".certificate-art-name");
  if (!art || !source || !name || !source.naturalWidth || !source.naturalHeight) return window.print();

  await document.fonts.ready;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = source.currentSrc || source.src;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("certificate_image_load_failed"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return window.print();
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const nameStyle = getComputedStyle(name);
  const imageRect = source.getBoundingClientRect();
  const nameRect = name.getBoundingClientRect();
  const fontScale = canvas.width / imageRect.width;
  const nameX = ((nameRect.left + nameRect.width / 2 - imageRect.left) / imageRect.width) * canvas.width;
  const nameY = ((nameRect.top + nameRect.height / 2 - imageRect.top) / imageRect.height) * canvas.height;
  context.direction = nameStyle.direction as CanvasDirection;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = nameStyle.color;
  context.font = `${nameStyle.fontWeight} ${parseFloat(nameStyle.fontSize) * fontScale}px ${nameStyle.fontFamily}`;
  context.shadowColor = "rgba(255,255,255,.5)";
  context.shadowBlur = 3 * fontScale;
  const studentName = name.textContent ?? "";
  const textMetrics = context.measureText(studentName);
  const textBaselineY = nameY + ((textMetrics.actualBoundingBoxAscent - textMetrics.actualBoundingBoxDescent) / 2);
  context.fillText(studentName, nameX, textBaselineY);

  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("certificate_render_failed")), "image/jpeg", 0.98));
  const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let byteOffset = 0;
  const write = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    byteOffset += bytes.length;
  };
  write("%PDF-1.4\n% EduHelp certificate\n");
  const pageWidth = 842;
  const pageHeight = pageWidth * canvas.height / canvas.width;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Cert 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
  ];
  objects.forEach((object, index) => {
    offsets.push(byteOffset);
    write(`${index + 1} 0 obj\n${object}`);
    if (index === 3) {
      write(jpegBytes);
      write("\nendstream\nendobj\n");
    } else write("\nendobj\n");
  });
  const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Cert Do\nQ\n`;
  offsets.push(byteOffset);
  write(`5 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
  const xrefOffset = byteOffset;
  write(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const pdfParts = chunks.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
  const url = URL.createObjectURL(new Blob(pdfParts, { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "EduHelp-certificate.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type Data = {
  student_name: string; exam_title: string; course_title: string; percent: number;
  issued_at: string; teacher_name: string | null; certificate_template_url?: string | null;
  certificate_name_x?: number; certificate_name_y?: number; certificate_name_color?: string; certificate_name_size?: number;
};

export default function PublicCertificate({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [aspect, setAspect] = useState(1.414);
  useEffect(() => {
    if (!/^[a-f0-9]{48}$/i.test(token)) { setLoading(false); return; }
    supabase.rpc("get_public_exam_certificate", { p_token: token }).then(({ data: result }) => {
      setData((result as Data | null) ?? null);
      setLoading(false);
    });
  }, [token]);

  const templateAspect = data?.certificate_template_url ? aspect : null;
  return <main className={`certificate-page${templateAspect ? " certificate-page-template" : ""}`} dir="rtl" style={templateAspect ? ({ "--certificate-aspect": templateAspect } as React.CSSProperties) : undefined}>
    {templateAspect ? <style media="print">{`@page { size: 297mm ${297 / templateAspect}mm; margin: 0; }`}</style> : null}
    {loading ? <div className="certificate-loading">جارٍ تحميل الشهادة...</div> : data ? <article className="certificate-sheet">
      {data.certificate_template_url ? <div className="certificate-art" style={{ aspectRatio: aspect, "--certificate-aspect": aspect } as React.CSSProperties}>
        <img src={data.certificate_template_url} alt={`شهادة ${data.student_name}`} onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || 1.414)} />
        <span className="certificate-art-name" style={{
          left: `${data.certificate_name_x ?? 50}%`, top: `${data.certificate_name_y ?? 48}%`,
          color: data.certificate_name_color ?? "#123B59", fontSize: `${data.certificate_name_size ?? 5.2}cqw`,
        }}>{data.student_name}</span>
      </div> : <div className="certificate-frame"><div className="certificate-brand">Edu<span>Help</span></div><span className="certificate-award"><i className="fa-solid fa-award" /> شهادة إنجاز</span><h1>شهادة اجتياز</h1><p className="certificate-intro">تشهد منصة EduHelp بأن الطالب/ة</p><h2>{data.student_name}</h2><p className="certificate-intro">قد اجتاز/ت بنجاح</p><h3>{data.exam_title}</h3><p className="certificate-course">{data.course_title}</p><div className="certificate-score"><small>الدرجة</small><bdi>{data.percent}%</bdi></div><div className="certificate-sign"><span>مدرس المادة<strong>{data.teacher_name || "مدرسك"}</strong></span><span>تاريخ الإصدار<strong>{new Date(data.issued_at).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "long" })}</strong></span></div><div className="certificate-seal"><i className="fa-solid fa-check" /></div></div>}
      <div className="certificate-details"><b>{data.exam_title}</b><span>{data.course_title} · {new Date(data.issued_at).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "long" })}</span></div>
      <button className="certificate-print" onClick={() => void downloadCertificatePdf()}><i className="fa-solid fa-file-pdf" /> تحميل الشهادة PDF للطباعة</button>
    </article> : <div className="tc-page"><div className="tc-empty"><b>الشهادة غير متاحة</b><p>الرابط غير صحيح أو الشهادة لم تعد متاحة.</p></div></div>}
  </main>;
}
