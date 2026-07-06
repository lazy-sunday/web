// /rules — the rulebook, rendered from the repo-root markdown at build time.

import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { mdToHtml } from '../../lib/markdown';

export const dynamic = 'force-static';

export const metadata = { title: 'LAZY SUNDAY — Rules' };

export default function RulesPage() {
  // apps/web is cwd for both `next dev` and `next build`.
  const mdPath = path.join(process.cwd(), '..', '..', 'lazy-sunday-rules-v1.md');
  const md = fs.readFileSync(mdPath, 'utf8');
  const html = mdToHtml(md);
  return (
    <main className="rules-page">
      <Link href="/" className="back-link">
        &larr; Back to the fridge
      </Link>
      <article className="rules-body" dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
