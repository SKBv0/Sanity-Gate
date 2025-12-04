import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sanity Gate',
  description: 'Code quality and project hygiene scanner',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

