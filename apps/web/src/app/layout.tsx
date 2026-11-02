import '../styles/globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Qamqor — Платформа мониторинга и геофенсинга скота',
  description: 'Аппаратно-программная IoT-система для фермеров Казахстана',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/maplibre-gl@5.1.0/dist/maplibre-gl.css"
        />
      </head>
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}

