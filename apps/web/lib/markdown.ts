// Tiny markdown -> HTML converter for the rules page. Handles exactly what
// lazy-sunday-rules-v1.md uses: headings, hr, tables, lists, bold, inline code,
// blockquotes, links, paragraphs. Emphasis renders as <strong> — the visual
// system forbids italics everywhere.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(md: string): string {
  let s = escapeHtml(md);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Single-asterisk emphasis: bold, never italic (locked visual system).
  s = s.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

export function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      flushPara();
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushPara();
      out.push('<hr />');
      i++;
      continue;
    }

    if (trimmed.startsWith('|')) {
      flushPara();
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        tableLines.push((lines[i] ?? '').trim());
        i++;
      }
      out.push(renderTable(tableLines));
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? '').trim())) {
        let item = (lines[i] ?? '').trim().replace(/^[-*]\s+/, '');
        i++;
        // continuation lines (indented, not a new bullet/blank)
        while (
          i < lines.length &&
          (lines[i] ?? '').trim() !== '' &&
          !/^[-*]\s+/.test((lines[i] ?? '').trim()) &&
          /^\s+/.test(lines[i] ?? '')
        ) {
          item += ' ' + (lines[i] ?? '').trim();
          i++;
        }
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? '').trim())) {
        let item = (lines[i] ?? '').trim().replace(/^\d+\.\s+/, '');
        i++;
        while (
          i < lines.length &&
          (lines[i] ?? '').trim() !== '' &&
          !/^\d+\.\s+/.test((lines[i] ?? '').trim()) &&
          /^\s+/.test(lines[i] ?? '')
        ) {
          item += ' ' + (lines[i] ?? '').trim();
          i++;
        }
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quote.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara();
  return out.join('\n');
}

function renderTable(rows: string[]): string {
  const parse = (row: string): string[] =>
    row
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

  if (rows.length < 2) return '';
  const header = parse(rows[0]!);
  const body = rows.slice(2).map(parse); // rows[1] is the |---|---| separator
  const thead = `<thead><tr>${header.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<div class="table-scroll"><table>${thead}${tbody}</table></div>`;
}
