import React from 'react';

// Live preview of the "eTOM L2 - SID ABEs links" diagram (component spec
// section 2.3), built straight from LinksStep's own link rows so an edit
// (add/remove a row, retype a label, flip Direction) is reflected here on
// the very next render - no save, no round trip. Deliberately ports the
// same box-column layout the real specification-publishing pipeline uses
// to render this diagram (see component-specification-documentation's
// scripts/render_etom_sid_svg.py) rather than PlantUML's auto-layout, so
// what's previewed here doesn't diverge from what actually ends up in the
// published document once this component's Links file is picked up there.
const BOX_W = 260;
const BOX_H = 70;
const BOX_GAP = 30;
const COL_GAP = 220;
const MARGIN = 30;
const LEGEND_W = 210;
const ARROW_LEN = 12;
const ARROW_W = 8;

// Direction column values (see LinksStep.jsx's ETOM_SID_DIRECTIONS) -> the
// render script's own vocabulary: "produced" means the arrowhead lands on
// the SID end (the activity produces that data), "consumed" means it lands
// on the eTOM end (the activity consumes it).
const DIRECTION_MAP = {
  bidirectional: 'bidirectional',
  'activity produces': 'produced',
  'activity consumes': 'consumed',
};

// Collapses the raw link rows down to the unique eTOM/SID boxes this
// diagram needs plus the resolved (key-based) edges between them - blank
// rows (label not chosen on either side yet) are skipped rather than drawn
// as empty boxes.
function buildEntries(links) {
  const etomOrder = [];
  const sidOrder = [];
  const etomKey = new Map();
  const sidKey = new Map();

  const cleaned = links
    .map((l) => ({
      etom: (l.etomActivity || '').trim(),
      sid: (l.sidABE || '').trim(),
      direction: DIRECTION_MAP[l.direction] || 'bidirectional',
    }))
    .filter((l) => l.etom && l.sid);

  cleaned.forEach((l) => {
    if (!etomKey.has(l.etom)) {
      etomKey.set(l.etom, `ETOM_${etomOrder.length}`);
      etomOrder.push(l.etom);
    }
    if (!sidKey.has(l.sid)) {
      sidKey.set(l.sid, `SID_${sidOrder.length}`);
      sidOrder.push(l.sid);
    }
  });

  return {
    etomEntries: etomOrder.map((label) => ({ key: etomKey.get(label), label })),
    sidEntries: sidOrder.map((label) => ({ key: sidKey.get(label), label })),
    resolvedLinks: cleaned.map((l) => ({
      etom: etomKey.get(l.etom),
      sid: sidKey.get(l.sid),
      direction: l.direction,
    })),
  };
}

function arrowhead(key, px, py, ux, uy) {
  const bx = px - ARROW_LEN * ux;
  const by = py - ARROW_LEN * uy;
  const lx = bx + (ARROW_W / 2) * -uy;
  const ly = by + (ARROW_W / 2) * ux;
  const rx = bx - (ARROW_W / 2) * -uy;
  const ry = by - (ARROW_W / 2) * ux;
  return <polygon key={key} points={`${px},${py} ${lx},${ly} ${rx},${ry}`} fill="currentColor" />;
}

function dashedBox(key, x, y, w, h, label) {
  const lines = label.split('\n');
  let ty = y + h / 2 - (lines.length - 1) * 7 + 5;
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} fill="var(--diagram-box-bg, #fff)" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6,3" />
      {lines.map((line, i) => {
        const el = <text key={i} x={x + w / 2} y={ty} textAnchor="middle" fontSize="12">{line}</text>;
        ty += 15;
        return el;
      })}
    </g>
  );
}

function cylinder(key, x, y, w, h, label) {
  const ellipseH = h * 0.22;
  const lines = label.split('\n');
  let ty = y + h / 2 + ellipseH / 4 - (lines.length - 1) * 7;
  return (
    <g key={key}>
      <path
        d={`M ${x} ${y + ellipseH / 2} L ${x} ${y + h - ellipseH / 2} A ${w / 2} ${ellipseH / 2} 0 0 0 ${x + w} ${y + h - ellipseH / 2} L ${x + w} ${y + ellipseH / 2} A ${w / 2} ${ellipseH / 2} 0 0 0 ${x} ${y + ellipseH / 2} Z`}
        fill="var(--diagram-box-bg, #fff)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <ellipse cx={x + w / 2} cy={y + ellipseH / 2} rx={w / 2} ry={ellipseH / 2} fill="var(--diagram-box-bg, #fff)" stroke="currentColor" strokeWidth="1.5" />
      {lines.map((line, i) => {
        const el = <text key={i} x={x + w / 2} y={ty} textAnchor="middle" fontSize="12">{line}</text>;
        ty += 15;
        return el;
      })}
    </g>
  );
}

export default function EtomSidDiagram({ links }) {
  const { etomEntries, sidEntries, resolvedLinks } = buildEntries(links || []);

  if (etomEntries.length === 0 || sidEntries.length === 0 || resolvedLinks.length === 0) {
    return <p className="hint">Choose an eTOM activity and a SID ABE on at least one row below to preview the diagram.</p>;
  }

  const etomColH = etomEntries.length * BOX_H + Math.max(etomEntries.length - 1, 0) * BOX_GAP;
  const sidColH = sidEntries.length * BOX_H + Math.max(sidEntries.length - 1, 0) * BOX_GAP;
  const colH = Math.max(etomColH, sidColH);

  const etomX = MARGIN;
  const sidX = MARGIN + BOX_W + COL_GAP;
  const canvasW = sidX + BOX_W + MARGIN + LEGEND_W;
  const canvasH = colH + MARGIN * 2;

  const etomY0 = MARGIN + (colH - etomColH) / 2;
  const sidY0 = MARGIN + (colH - sidColH) / 2;

  const etomPos = new Map(etomEntries.map((e, i) => [e.key, etomY0 + i * (BOX_H + BOX_GAP)]));
  const sidPos = new Map(sidEntries.map((s, i) => [s.key, sidY0 + i * (BOX_H + BOX_GAP)]));

  const etomLinkCount = new Map();
  const sidLinkCount = new Map();
  resolvedLinks.forEach((l) => {
    etomLinkCount.set(l.etom, (etomLinkCount.get(l.etom) || 0) + 1);
    sidLinkCount.set(l.sid, (sidLinkCount.get(l.sid) || 0) + 1);
  });
  const etomSeen = new Map();
  const sidSeen = new Map();

  const edgeElements = [];
  resolvedLinks.forEach((link, i) => {
    const ex = etomX + BOX_W;
    const eyBase = etomPos.get(link.etom);
    const countE = etomLinkCount.get(link.etom);
    const idxE = etomSeen.get(link.etom) || 0;
    etomSeen.set(link.etom, idxE + 1);
    const ey = eyBase + (idxE + 1) * (BOX_H / (countE + 1));

    const sx = sidX;
    const syBase = sidPos.get(link.sid);
    const countS = sidLinkCount.get(link.sid);
    const idxS = sidSeen.get(link.sid) || 0;
    sidSeen.set(link.sid, idxS + 1);
    const sy = syBase + (idxS + 1) * (BOX_H / (countS + 1));

    const dx = sx - ex;
    const dy = sy - ey;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    edgeElements.push(<line key={`line-${i}`} x1={ex} y1={ey} x2={sx} y2={sy} stroke="currentColor" strokeWidth="1.5" />);
    if (link.direction === 'produced' || link.direction === 'bidirectional') {
      edgeElements.push(arrowhead(`arr-s-${i}`, sx, sy, ux, uy));
    }
    if (link.direction === 'consumed' || link.direction === 'bidirectional') {
      edgeElements.push(arrowhead(`arr-e-${i}`, ex, ey, -ux, -uy));
    }
  });

  const boxElements = [
    ...etomEntries.map((e) => dashedBox(e.key, etomX, etomPos.get(e.key), BOX_W, BOX_H, e.label)),
    ...sidEntries.map((s) => cylinder(s.key, sidX, sidPos.get(s.key), BOX_W, BOX_H, s.label)),
  ];

  const lx = sidX + BOX_W + 40;
  const lyActivity = MARGIN;
  const lyEntity = lyActivity + 28;
  const lyProduced = lyEntity + 28;
  const lyConsumed = lyProduced + 24;

  return (
    <svg viewBox={`0 0 ${canvasW} ${canvasH}`} style={{ width: '100%', height: 'auto', display: 'block', color: 'var(--fg)' }} xmlns="http://www.w3.org/2000/svg">
      {edgeElements}
      {boxElements}

      <rect x={lx} y={lyActivity - 10} width="20" height="14" fill="var(--diagram-box-bg, #fff)" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4,2" />
      <text x={lx + 30} y={lyActivity} fontSize="12">eTOM Business Activity</text>
      <ellipse cx={lx + 10} cy={lyEntity - 4} rx="10" ry="6" fill="var(--diagram-box-bg, #fff)" stroke="currentColor" strokeWidth="1.5" />
      <text x={lx + 30} y={lyEntity} fontSize="12">SID Data Entity</text>
      <line x1={lx} y1={lyProduced - 4} x2={lx + 24} y2={lyProduced - 4} stroke="currentColor" strokeWidth="1.5" />
      {arrowhead('legend-produced', lx + 24, lyProduced - 4, 1, 0)}
      <text x={lx + 34} y={lyProduced} fontSize="12">produced by the activity</text>
      <line x1={lx} y1={lyConsumed - 4} x2={lx + 24} y2={lyConsumed - 4} stroke="currentColor" strokeWidth="1.5" />
      {arrowhead('legend-consumed', lx, lyConsumed - 4, -1, 0)}
      <text x={lx + 34} y={lyConsumed} fontSize="12">consumed by the activity</text>
    </svg>
  );
}
