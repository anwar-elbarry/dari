import type { ReactNode } from 'react';

export const metadata = { title: 'Dari — STR Compliance' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
