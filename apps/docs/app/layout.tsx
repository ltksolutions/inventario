// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import 'nextra-theme-docs/style.css';

export const metadata: Metadata = {
  title: {
    default: 'Inventario · Dokumentácia',
    template: '%s · Inventario Docs',
  },
  description:
    'Oficiálna dokumentácia projektu Inventario — open-source multi-tenant platforma pre evidenciu a vypožičiavanie majetku. EUPL-1.2 licencia.',
};

const navbar = (
  <Navbar logo={<b>Inventario Docs</b>} projectLink="https://github.com/ltksolutions/inventario" />
);

const footer = <Footer>v0.3 · EUPL-1.2 · © 2026 LTK Solutions</Footer>;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const pageMap = await getPageMap();

  return (
    <html lang="sk" dir="ltr" suppressHydrationWarning>
      <Head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </Head>
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/ltksolutions/inventario/tree/main/apps/docs"
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
