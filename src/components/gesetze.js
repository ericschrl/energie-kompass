let selectedGesetz = null;

function renderGesetze() {
  const el = document.getElementById('page-gesetze');
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Gesetzgebungs-Tracker</h1>
        <p>${GESETZE.length} aktive Vorhaben · Stand: 14.06.2024</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <div class="filter-tabs">
          <button class="filter-tab active" onclick="filterGesetze('alle',this)">Alle</button>
          <button class="filter-tab" onclick="filterGesetze('hoch',this)">Hohe Priorität</button>
          <button class="filter-tab" onclick="filterGesetze('aktiv',this)">Aktiv im BT</button>
        </div>
      </div>
    </div>

    <div class="page-body">
      <div id="gesetze-liste">
        ${GESETZE.map(g => renderGesetzKarte(g)).join('')}
      </div>
    </div>

    <!-- Detail Panel -->
    <div class="detail-panel" id="detail-panel">
      <div class="detail-panel-header">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div id="dp-name" style="font-size:16px;font-weight:600;color:var(--text-primary);"></div>
            <div id="dp-ressort" style="font-size:12px;color:var(--text-muted);margin-top:2px;"></div>
          </div>
          <button class="close-btn" onclick="closeDetailPanel()">✕</button>
        </div>
        <div id="dp-prozess" style="margin-top:16px;"></div>
      </div>
      <div class="detail-panel-body" id="dp-body"></div>
    </div>
  `;
}

function renderGesetzKarte(g) {
  const prio_color = g.prioritaet === 'hoch' ? 'var(--red)' : g.prioritaet === 'mittel' ? 'var(--amber)' : 'var(--text-muted)';
  const phase_done = g.phasen.filter(p => p.status === 'done').length;
  const current_phase = g.phasen.find(p => p.status === 'active');

  return `
    <div class="card gesetz-karte" data-id="${g.id}" data-prio="${g.prioritaet}" data-phase="${g.phase}" style="margin-bottom:12px;cursor:pointer;transition:border-color 0.15s;" onclick="openDetailPanel('${g.id}')" onmouseenter="this.style.borderColor='var(--border-strong)'" onmouseleave="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary);">${g.name}</div>
          <span class="tag tag-${g.tags[0] || 'default'}">${g.kurz}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:${prio_color};font-weight:600;text-transform:uppercase;letter-spacing:0.3px;">${g.prioritaet}</span>
          <span style="font-size:11px;color:var(--text-muted);">→</span>
        </div>
      </div>

      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;">${g.beschreibung}</div>

      <!-- Prozess-Tracker (Signature Element) -->
      <div class="prozess-tracker">
        ${g.phasen.map((p, i) => `
          <div class="prozess-step ${p.status}">
            <div class="prozess-dot">${p.status === 'done' ? '✓' : i + 1}</div>
            <div class="prozess-label">${p.label}</div>
            <div class="prozess-date">${p.datum}</div>
          </div>
        `).join('')}
      </div>

      <div class="divider" style="margin:14px 0 10px;"></div>

      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:11px;color:var(--text-muted);">
          <span style="color:var(--accent);font-weight:500;">Nächster Schritt:</span>
          ${g.nächsterSchritt}
        </div>
        <div style="font-size:11px;color:var(--text-muted);">
          ${g.positionen.length} Positionen · ${NEWS.filter(n => g.news.includes(n.id)).length} News
        </div>
      </div>
    </div>
  `;
}

function filterGesetze(filter, btn) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const liste = document.getElementById('gesetze-liste');
  let gefiltert = GESETZE;
  if (filter === 'hoch') gefiltert = GESETZE.filter(g => g.prioritaet === 'hoch');
  if (filter === 'aktiv') gefiltert = GESETZE.filter(g => g.phasen.some(p => p.status === 'active' && ['1. Lesung','Ausschuss'].some(s => p.label.includes(s) || p.label.includes('Lesung') || p.label.includes('Ausschuss'))));
  liste.innerHTML = gefiltert.map(g => renderGesetzKarte(g)).join('');
}

function openDetailPanel(id) {
  const g = GESETZE.find(x => x.id === id);
  if (!g) return;
  selectedGesetz = g;

  document.getElementById('dp-name').textContent = g.name;
  document.getElementById('dp-ressort').textContent = `${g.ressort} · Referat ${g.referat}`;

  // Prozess-Tracker im Panel
  document.getElementById('dp-prozess').innerHTML = `
    <div class="prozess-tracker" style="margin:8px 0;">
      ${g.phasen.map((p, i) => `
        <div class="prozess-step ${p.status}">
          <div class="prozess-dot">${p.status === 'done' ? '✓' : i + 1}</div>
          <div class="prozess-label">${p.label}</div>
          <div class="prozess-date">${p.datum}</div>
        </div>
      `).join('')}
    </div>
  `;

  // Body
  const news_related = NEWS.filter(n => g.news.includes(n.id));

  document.getElementById('dp-body').innerHTML = `

    <div style="margin-bottom:20px;">
      <div class="section-title">Aktueller Stand</div>
      <div class="alert alert-amber">${g.nächsterSchritt}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:6px;">Letzte Aktion: ${g.letzteAktion}</div>
    </div>

    <div style="margin-bottom:20px;">
      <div class="section-title">Ansprechpartner Ministerium</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${g.ansprechpartner.ministerium.map(a => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border);">
            <div>
              <div style="font-size:13px;font-weight:500;color:var(--text-primary);">${a.name}</div>
              <div style="font-size:11px;color:var(--text-muted);">${a.funktion}</div>
            </div>
            <a href="mailto:${a.email}" style="font-size:11px;color:var(--accent);text-decoration:none;">${a.email}</a>
          </div>
        `).join('')}
      </div>
    </div>

    <div style="margin-bottom:20px;">
      <div class="section-title">Berichterstatter / Fraktionen</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${g.ansprechpartner.bundestag.map(a => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border);">
            <div style="width:8px;height:8px;border-radius:50%;background:${a.partei_color};flex-shrink:0;"></div>
            <div style="flex:1;">
              <span style="font-size:13px;font-weight:500;color:var(--text-primary);">${a.name}</span>
              <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${a.fraktion} · ${a.funktion}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div style="margin-bottom:20px;">
      <div class="section-title">Stakeholder-Positionen</div>
      <div style="background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid var(--border);overflow:hidden;">
        <table class="position-matrix" style="width:100%;">
          <thead>
            <tr>
              <th style="padding-left:12px;">Akteur</th>
              <th>Typ</th>
              <th>Position</th>
              <th>Kommentar</th>
            </tr>
          </thead>
          <tbody>
            ${g.positionen.map(p => `
              <tr>
                <td style="padding-left:12px;font-weight:500;color:var(--text-primary);">${p.akteur}</td>
                <td style="font-size:11px;">${p.typ}</td>
                <td><span class="pos-${p.position}">${p.position.charAt(0).toUpperCase()+p.position.slice(1)}</span></td>
                <td style="font-size:11px;line-height:1.4;">${p.kommentar}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <div class="section-title">Zugeordnete Meldungen</div>
      ${news_related.length === 0 ? '<div style="color:var(--text-muted);font-size:12px;">Keine Meldungen zugeordnet.</div>' : ''}
      ${news_related.map(n => `
        <div class="news-item">
          <div class="news-source-dot" style="background:${n.quelleColor};"></div>
          <div class="news-content">
            <div class="news-title">${n.titel}</div>
            <div class="news-meta"><span>${n.quelle}</span><span>${n.datum}</span></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('detail-panel').classList.add('open');
}

function closeDetailPanel() {
  document.getElementById('detail-panel').classList.remove('open');
}
