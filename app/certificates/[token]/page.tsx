import type { Metadata } from "next";
import PublicCertificate from "@/components/dashboard/PublicCertificate";

export const metadata: Metadata = { title: "شهادة إنجاز | EduHelp", robots: { index: false, follow: false } };
export default function PublicCertificateRoute({ params }: { params: { token: string } }) { return <PublicCertificate token={params.token} />; }
