import "./globals.css";
import "./toasts.css";
import type { Metadata } from "next";
import ErrorToastProvider from "@/components/ErrorToastProvider";
import PublicSiteChrome from "@/components/PublicSiteChrome";
import MaintenanceGate from "@/components/MaintenanceGate";

export const metadata: Metadata = {
  title: "EduHelp | منصة التعليم الابتدائي — شرح وامتحانات ومذكرات PDF",
  description:
    "منصة EduHelp التعليمية للمرحلة الابتدائية في مصر. شرح مبسط لكل درس، امتحانات تلقائية، مذكرات PDF، ومتابعة درجات الطالب من الصف الثالث حتى السادس.",
  keywords: ["منصة تعليمية", "تعليم ابتدائي", "مذاكرة اون لاين", "امتحانات اون لاين", "مذكرات PDF", "EduHelp"],
  openGraph: {
    type: "website",
    siteName: "EduHelp",
    title: "EduHelp | منصة التعليم الابتدائي",
    description: "شرح مبسط لكل درس، امتحانات تلقائية، ومذكرات PDF للصف الثالث حتى السادس ابتدائي.",
    locale: "ar_EG",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&family=Tajawal:wght@200;300;400;500;600;700;800;900&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"
        />
      </head>
      <body>
        <MaintenanceGate>
          <PublicSiteChrome>{children}</PublicSiteChrome>
        </MaintenanceGate>
        <ErrorToastProvider />
      </body>
    </html>
  );
}
