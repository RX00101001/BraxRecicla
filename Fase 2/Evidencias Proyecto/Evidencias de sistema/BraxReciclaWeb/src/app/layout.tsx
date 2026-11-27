import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://braxrecicla.cl"),
  title: {
    default: "BraxRecicla · Economía Circular & Trazabilidad Oficial (Ley REP)",
    template: "%s · BraxRecicla"
  },
  description: "Transformamos residuos en recursos circulares mediante logística responsable, pesaje industrial verificado con Báscula Romana RS-232 y trazabilidad oficial ante el Ministerio del Medio Ambiente (SINADER / Ley REP N° 20.920).",
  keywords: [
    "BraxRecicla",
    "reciclaje chile",
    "ley rep",
    "sinader",
    "gestion de residuos",
    "chatarra industrial",
    "economia circular",
    "trazabilidad ambiental",
    "retiro de reciclaje",
    "santiago de chile"
  ],
  authors: [{ name: "BraxRecicla SpA", url: "https://braxrecicla.cl" }],
  creator: "BraxRecicla SpA",
  publisher: "BraxRecicla SpA",
  openGraph: {
    title: "BraxRecicla · Economía Circular & Trazabilidad Oficial (Ley REP)",
    description: "Gestión inteligente de residuos industriales y ciudadanos con pesaje verificado RS-232, certificación criptográfica SHA-256 y cumplimiento estricto de la Ley REP N° 20.920.",
    url: "https://braxrecicla.cl",
    siteName: "BraxRecicla",
    locale: "es_CL",
    type: "website",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "BraxRecicla - Logo 3D Oficial y Plataforma de Reciclaje",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BraxRecicla · Economía Circular & Trazabilidad Oficial",
    description: "Gestión inteligente de residuos industriales y ciudadanos con pesaje certificado RS-232 y trazabilidad ante SINADER.",
    images: ["/og-image.jpg"],
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@1&display=swap" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=sentient@400,301&display=swap" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
