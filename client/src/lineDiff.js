function linesOf(text) {
  return text === '' ? [] : text.split('\n');
}

// Classic LCS-based line diff (O(n*m) time/space) - fine for component YAML
// files (well under a few thousand lines), and avoids pulling in a diff
// dependency for one feature.
export function diffLines(aText, bText) {
  const a = linesOf(aText);
  const b = linesOf(bText);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', aLine: a[i], bLine: b[j], aNum: i + 1, bNum: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', aLine: a[i], aNum: i + 1 });
      i++;
    } else {
      rows.push({ type: 'add', bLine: b[j], bNum: j + 1 });
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: 'del', aLine: a[i], aNum: i + 1 });
    i++;
  }
  while (j < m) {
    rows.push({ type: 'add', bLine: b[j], bNum: j + 1 });
    j++;
  }
  return rows;
}

// Pairs up consecutive del/add runs so a side-by-side view can show them on
// the same visual row (deletion on the left, its replacement on the right),
// same convention as GitHub/most diff viewers, rather than stacking all
// deletions above all additions.
export function buildSideBySideRows(rows) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.type === 'same') {
      out.push({ left: row, right: row });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < rows.length && rows[i].type !== 'same') {
      if (rows[i].type === 'del') dels.push(rows[i]);
      else adds.push(rows[i]);
      i++;
    }
    const max = Math.max(dels.length, adds.length);
    for (let k = 0; k < max; k++) {
      out.push({ left: dels[k] || null, right: adds[k] || null });
    }
  }
  return out;
}
