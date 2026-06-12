function renderStakeholder() {
  const el = document.getElementById('page-stakeholder');

  const typen = ['Alle', 'Verband', 'Behörde', 'Unternehmen', 'Thinktank', 'NGO'];

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Stakeholder-Übersicht</h1>
        <p>${STAKEHOLDER.length} Akteure · Energiepolitische Landschaft</p>
      </div>
      <div class="filter-tabs">
        ${typen.map((t, i) => `<button class="filter-tab ${i===0?'active':''}" onclick="filterStakeholder('${t}',this)">${t}</button>`).join('')}
      </div>
    </div>

    <div class="page-body">
      <div class="section-title">Positionslandschaft</div>
      <div style="display:flex;gap:12px;margin-bottom:24px;">
        ${['pro','neutral','contra'].map(pos => {
          const count = STAKEHOLDER.filter(s => s.position_gesamt === pos).length;
          const col = pos === 'pro' ? 'var(--green)' : pos === 'contra' ? 'var(--red)' : 'var(--amber)';
          const bg = pos === 'pro' ? 'rgba(34,197,94,0.08)' : pos === 'contra' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)';
          return `
            <div style="flex:1;background:${bg};border:1px solid ${col}33;border-radius:var(--radius-md);padding:14px 16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:${col};">${count}</div>
              <div style="font-size:12px;color:var(--text-muted);text-transform:capitalize;">${pos === 'pro' ? 'Unterstützend' : pos === 'contra' ? 'Kritisch' : 'Neutral / Abwägend'}</div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="section-title">Akteure</div>
      <div class="grid-3" id="stakeholder-grid">
        ${STAKEHOLDER.map(s => renderStakeholderKarte(s)).join('')}
      </div>
    </div>
  `;
}

function renderStakeholderKarte(s) {
  const pos_color = s.position_gesamt === 'pro' ? 'var(--green)' : s.position_gesamt === 'contra' ? 'var(--red)' : 'var(--amber)';
  const pos_label = s.position_gesamt === 'pro' ? 'Unterstützend' : s.position_gesamt === 'contra' ? 'Kritisch' : 'Neutral';
  const rel_color = s.relevanz === 'hoch' ? 'var(--accent)' : 'var(--text-muted)';

  return `
    <div class="stakeholder-card" data-typ="${s.typ}">
      <div class="sh-header">
        <div class="sh-avatar">${s.name.substring(0,2).toUpperCase()}</div>
        <div>
          <div class="sh-name">${s.name}</div>
          <div class="sh-type">${s.typ} · <span style="color:${rel_color};font-weight:500;">${s.relevanz === 'hoch' ? 'Hohe Relevanz' : 'Mittlere Relevanz'}</span></div>
        </div>
      </div>

      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:10px;line-height:1.4;">${s.vollname}</div>

      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">${s.ansprechpartner}</div>

      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${s.hauptthemen.map(t => `<span class="tag tag-${t}">${t.toUpperCase()}</span>`).join('')}
        </div>
        <span style="font-size:11px;font-weight:600;color:${pos_color};">${pos_label}</span>
      </div>

      ${s.notizen ? `
        <div class="divider" style="margin:10px 0 8px;"></div>
        <div style="font-size:11px;color:var(--text-muted);line-height:1.4;font-style:italic;">${s.notizen}</div>
      ` : ''}

      ${s.lobbyregister_id ? `
        <div style="margin-top:8px;">
          <a href="https://www.lobbyregister.bundestag.de/suche/${s.lobbyregister_id}" target="_blank" style="font-size:10px;color:var(--text-muted);text-decoration:none;">
            🔗 Lobbyregister: ${s.lobbyregister_id}
          </a>
        </div>
      ` : ''}
    </div>
  `;
}

function filterStakeholder(typ, btn) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const grid = document.getElementById('stakeholder-grid');
  if (!grid) return;
  let gefiltert = typ === 'Alle' ? STAKEHOLDER : STAKEHOLDER.filter(s => s.typ === typ);
  grid.innerHTML = gefiltert.map(s => renderStakeholderKarte(s)).join('');
}
