import React, { useMemo, useState } from 'react';
import yaml from 'js-yaml';
import { buildComponent } from '../buildComponent.js';
import { diffLines, buildSideBySideRows } from '../lineDiff.js';

const YAML_OPTS = { sortKeys: false, lineWidth: -1, noArrayIndent: true };

export default function DiffStep({ state, original }) {
  const [layout, setLayout] = useState('side-by-side'); // 'side-by-side' | 'inline'

  const modifiedYamlText = useMemo(
    () => yaml.dump(buildComponent(state, original), YAML_OPTS),
    [state, original]
  );
  const originalYamlText = useMemo(
    () => (original ? yaml.dump(original, YAML_OPTS) : ''),
    [original]
  );

  const rows = useMemo(() => diffLines(originalYamlText, modifiedYamlText), [originalYamlText, modifiedYamlText]);
  const sideBySideRows = useMemo(() => buildSideBySideRows(rows), [rows]);
  const additions = rows.filter((r) => r.type === 'add').length;
  const deletions = rows.filter((r) => r.type === 'del').length;

  return (
    <div className="panel">
      <div className="diff-toolbar">
        <h3 style={{ margin: 0 }}>File comparison: <code>component.yaml</code></h3>
        <div className="diff-toolbar-right">
          <span className="diff-badge del">-{deletions} deletion{deletions === 1 ? '' : 's'}</span>
          <span className="diff-badge add">+{additions} addition{additions === 1 ? '' : 's'}</span>
          <div className="diff-layout-toggle">
            <button type="button" className={layout === 'side-by-side' ? 'primary' : ''} onClick={() => setLayout('side-by-side')}>Side-by-side</button>
            <button type="button" className={layout === 'inline' ? 'primary' : ''} onClick={() => setLayout('inline')}>Inline</button>
          </div>
        </div>
      </div>

      {!original && (
        <div className="status-banner ok">New component - every line below is an addition.</div>
      )}
      {original && additions === 0 && deletions === 0 && (
        <div className="status-banner ok">No changes since this component was loaded.</div>
      )}

      {layout === 'side-by-side' ? (
        <div className="diff-panes">
          <div className="diff-pane-header">Original (HEAD)</div>
          <div className="diff-pane-header">Modified (unsaved changes)</div>
          {sideBySideRows.map((row, idx) => (
            <React.Fragment key={idx}>
              <DiffCell entry={row.left} side="left" />
              <DiffCell entry={row.right} side="right" />
            </React.Fragment>
          ))}
        </div>
      ) : (
        <div className="diff-inline">
          {rows.map((row, idx) => (
            <div key={idx} className={`diff-line diff-line-${row.type}`}>
              <span className="diff-linenum">{row.type === 'add' ? '' : row.aNum}</span>
              <span className="diff-linenum">{row.type === 'del' ? '' : row.bNum}</span>
              <span className="diff-marker">{row.type === 'add' ? '+' : row.type === 'del' ? '-' : ''}</span>
              <span className="diff-text">{row.type === 'add' ? row.bLine : row.aLine}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffCell({ entry, side }) {
  if (!entry) return <div className="diff-line diff-line-empty" />;
  const text = side === 'left' ? entry.aLine : entry.bLine;
  const num = side === 'left' ? entry.aNum : entry.bNum;
  const cls = entry.type === 'same' ? 'diff-line-same' : entry.type === 'del' ? 'diff-line-del' : 'diff-line-add';
  return (
    <div className={`diff-line ${cls}`}>
      <span className="diff-linenum">{num}</span>
      <span className="diff-text">{text}</span>
    </div>
  );
}
