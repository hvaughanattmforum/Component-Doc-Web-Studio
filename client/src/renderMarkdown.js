// Client-side ports of server/index.js's renderLinksMarkdown/
// renderSupplementMarkdown(+renderSupplementTable) - kept byte-for-byte
// identical to those so a live preview here always matches what a save
// would actually write to disk. There's no shared module between the client
// (Vite/browser) and server (Node) in this repo, so this is a deliberate,
// contained duplication of two short, stable, pure functions - same
// tradeoff already accepted for YamlPane.jsx's parseGithubRemote() mirroring
// server/index.js's repoOwnerAndName(). If either server function changes,
// update its twin here too.

export function renderLinksMarkdown({ heading, notesBefore, notesAfter, links }, columns, fields) {
  const escapeCell = (v) => (v || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const parts = [`# ${heading}`, ''];
  if (notesBefore?.trim()) parts.push(notesBefore.trim(), '');
  parts.push(`| ${columns.join(' | ')} |`);
  parts.push(`|${columns.map(() => '---').join('|')}|`);
  for (const row of links) {
    parts.push(`| ${fields.map((f) => escapeCell(row[f])).join(' | ')} |`);
  }
  if (notesAfter?.trim()) parts.push('', notesAfter.trim());
  parts.push('');
  return parts.join('\n');
}

function renderSupplementTable(columns, rows) {
  const escapeCell = (v) => (v || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const parts = [`| ${columns.join(' | ')} |`, `|${columns.map(() => '---').join('|')}|`];
  for (const row of rows) {
    parts.push(`| ${columns.map((_, i) => escapeCell(row[i])).join(' | ')} |`);
  }
  return parts.join('\n');
}

export function renderSupplementMarkdown(parsed, meta) {
  const frontMatter = `---\nname: ${meta.name}\nversion: ${meta.version}\n---\n`;
  const parts = [
    parsed.jiraHeading, '', parsed.jiraBody, '',
    parsed.furtherHeading, '', parsed.furtherBody, '',
    parsed.appendixHeading, '',
    parsed.docHistoryHeading, '',
    parsed.versionHistoryHeading, '',
    renderSupplementTable(parsed.versionHistory.columns, parsed.versionHistory.rows), '',
    parsed.releaseHistoryHeading, '',
    renderSupplementTable(parsed.releaseHistory.columns, parsed.releaseHistory.rows), '',
    parsed.acknowledgementsHeading, '',
    parsed.ackIntro, '',
    renderSupplementTable(parsed.acknowledgements.columns, parsed.acknowledgements.rows),
  ];
  if (parsed.trailing) parts.push('', parsed.trailing);
  parts.push('');
  return `${frontMatter}\n${parts.join('\n')}`;
}
