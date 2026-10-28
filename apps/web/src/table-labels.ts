/**
 * Rótulo de coluna em cada célula das tabelas (`data-label`), para o celular mostrar cada linha como um cartão
 * "Coluna: valor" em vez de uma tabela que passa da borda da tela (2026-10-28). Células que já têm rótulo ficam
 * como estão; a prévia do documento (`.paper`) não muda, porque reproduz o original.
 */
function labelTable(table: HTMLTableElement) {
  const headers = [...(table.tHead?.rows[0]?.cells ?? [])].flatMap((cell) =>
    Array.from({ length: Math.max(1, cell.colSpan) }, () => (cell.textContent ?? '').trim()),
  );
  if (!headers.length) return;
  for (const body of table.tBodies)
    for (const row of body.rows) {
      let column = 0;
      for (const cell of row.cells) {
        const label = headers[column] ?? '';
        if (!cell.hasAttribute('data-label') && label) cell.setAttribute('data-label', label);
        column += Math.max(1, cell.colSpan);
      }
    }
}

export function labelTablesForMobile(root: HTMLElement = document.body) {
  let pending = false;
  const run = () => {
    pending = false;
    root.querySelectorAll<HTMLTableElement>('.table-wrap table').forEach((table) => {
      if (!table.closest('.paper')) labelTable(table);
    });
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(run);
  };
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true, characterData: true });
  schedule();
}
