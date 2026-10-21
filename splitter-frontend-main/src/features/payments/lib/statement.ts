/**
 * Builds the HTML of a settlement statement for expo-print. Pure: translation and money formatting are passed in.
 * A neutral record-keeping document: no bank logos, stamps or official-looking numbers; only usernames (no e-mails);
 * the legal note is always printed at the bottom.
 */
export const LEGAL_NOTE_KEY = 'payments.statement.legal';

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export interface StatementLine { label: string; value: string; strong?: boolean; muted?: boolean }
export interface StatementSection { title: string; rows: StatementLine[] }

export interface StatementModel {
  title: string;
  subtitle: string;
  /** e.g. "S-123": the bill number in the app, nothing more */
  shortId: string;
  generatedAt: string;
  sections: StatementSection[];
  legalNote: string;
  signature: string;
}

const row = (r: StatementLine) =>
  `<tr class="${r.strong ? 'strong' : ''}${r.muted ? ' muted' : ''}"><td>${escapeHtml(r.label)}</td><td class="num">${escapeHtml(r.value)}</td></tr>`;

export function statementHtml(m: StatementModel, opts: { dark?: boolean } = {}): string {
  void opts;
  const sections = m.sections
    .filter((s) => s.rows.length > 0)
    .map((s) => `<section><h2>${escapeHtml(s.title)}</h2><table>${s.rows.map(row).join('')}</table></section>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { margin: 24mm 18mm; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1d1d1f; font-size: 12px; line-height: 1.45; }
  header { border-bottom: 1px solid #d2d2d7; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; font-weight: 700; }
  .sub { color: #515154; }
  .meta { color: #6e6e73; font-size: 11px; margin-top: 6px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #6e6e73; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 0; border-bottom: 1px solid #f0f0f2; vertical-align: top; word-break: break-word; }
  td.num { text-align: right; white-space: nowrap; padding-left: 12px; font-variant-numeric: tabular-nums; }
  tr.strong td { font-weight: 700; border-bottom: 1px solid #d2d2d7; }
  tr.muted td { color: #6e6e73; }
  footer { margin-top: 28px; border-top: 1px solid #d2d2d7; padding-top: 10px; color: #6e6e73; font-size: 10px; }
  .sig { color: #1d1d1f; font-weight: 600; font-size: 11px; margin-bottom: 4px; }
</style></head><body>
<header><h1>${escapeHtml(m.title)}</h1><div class="sub">${escapeHtml(m.subtitle)}</div>
<div class="meta">${escapeHtml(m.shortId)} · ${escapeHtml(m.generatedAt)}</div></header>
${sections}
<footer><div class="sig">${escapeHtml(m.signature)}</div><div>${escapeHtml(m.legalNote)}</div></footer>
</body></html>`;
}

/** The same content as plain text (Share sheet / CSV-like copy). */
export function statementText(m: StatementModel): string {
  const lines = [m.title, m.subtitle, `${m.shortId} · ${m.generatedAt}`, ''];
  for (const s of m.sections) {
    if (!s.rows.length) continue;
    lines.push(s.title.toUpperCase());
    for (const r of s.rows) lines.push(`${r.label}: ${r.value}`);
    lines.push('');
  }
  lines.push(m.signature, m.legalNote);
  return lines.join('\n');
}
