function renderKontakte() {
  const el = document.getElementById('page-kontakte');
  const typen = ['Alle', 'Ministerium', 'Bundestag', 'Behörde'];

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Kontakte</h1>
        <p>Ansprechpartner in Ministerien, Bundestag und Behörden</p>
      </div>
      <div class="filter-tabs">
        ${typen.map((t, i) => `<button class="filter-tab ${i===0?'active':''}" onclick="filterKontakte('${t.toLowerCase()}',this)">${t}</button>`).join('')}
      </div>
    </div>

    <div class="page-body">
      <div class="grid-3" id="kontakte-grid">
        ${KONTAKTE.map(k => renderKontaktKarte(k)).join('')}
      </div>
    </div>
  `;
}

function renderKontaktKarte(k) {
  const typ_label = k.typ === 'ministerium' ? 'Ministerium' : k.typ === 'bundestag' ? 'Bundestag' : 'Behörde';
  const typ_color = k.typ === 'ministerium' ? 'var(--amber)' : k.typ === 'bundestag' ? 'var(--blue)' : 'var(--text-muted)';

  const gesetze_refs = k.gesetze_ref.map(ref => {
    const g = GESETZE.find(x => x.id === ref);
    return g ? `<span class="tag tag-${g.tags[0] || 'default'}" style="cursor:pointer;" onclick="switchPage('gesetze')">${g.kurz}</span>` : '';
  }).join('');

  return `
    <div class="kontakt-card" data-typ="${k.typ}">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <div class="kontakt-avatar">${k.initials}</div>
        <div>
          <div class="kontakt-name">${k.name}</div>
          <div class="kontakt-title">${k.funktion}</div>
          <div class="kontakt-org">${k.organisation}</div>
        </div>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:0;">
        <div class="kontakt-row">
          <span class="kontakt-label">E-Mail</span>
          <span class="kontakt-value"><a href="mailto:${k.email}">${k.email}</a></span>
        </div>
        <div class="kontakt-row">
          <span class="kontakt-label">Telefon</span>
          <span class="kontakt-value">${k.telefon}</span>
        </div>
        <div class="kontakt-row">
          <span class="kontakt-label">Typ</span>
          <span style="font-size:11px;font-weight:600;color:${typ_color};">${typ_label}</span>
        </div>
        <div class="kontakt-row">
          <span class="kontakt-label">Themen</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">${gesetze_refs}</div>
        </div>
        <div class="kontakt-row">
          <span class="kontakt-label">Letzter Kontakt</span>
          <span class="kontakt-value">${k.letzter_kontakt}</span>
        </div>
      </div>

      ${k.notizen ? `
        <div style="margin-top:12px;padding:8px 10px;background:var(--bg-elevated);border-radius:var(--radius-sm);font-size:11px;color:var(--text-muted);line-height:1.5;border-left:2px solid var(--accent);">
          ${k.notizen}
        </div>
      ` : ''}
    </div>
  `;
}

function filterKontakte(typ, btn) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const grid = document.getElementById('kontakte-grid');
  if (!grid) return;
  let gefiltert = typ === 'alle' ? KONTAKTE : KONTAKTE.filter(k => k.typ === typ);
  grid.innerHTML = gefiltert.map(k => renderKontaktKarte(k)).join('');
}
