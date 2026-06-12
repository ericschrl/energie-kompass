function renderNews() {
  const el = document.getElementById('page-news');
  const themen = ['Alle', 'EEG', 'Netz', 'eMob', 'ETS', 'Markt'];
  const quellen = ['Alle Quellen', 'energate', 'Tagesspiegel BG', 'Contexte', 'E.ON intern', 'Bundestag', 'BMWK'];

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>News-Monitor</h1>
        <p>${NEWS.length} Meldungen · ${NEWS.filter(n=>!n.gelesen).length} ungelesen · Letztes Update: Heute 09:14</p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="btn-alle-gelesen" onclick="alleAlsGelesenMarkieren()">Alle als gelesen</button>
      </div>
    </div>

    <div class="page-body">

      <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">
        <div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Thema</div>
          <div class="filter-tabs">
            ${themen.map((t, i) => `<button class="filter-tab ${i===0?'active':''}" onclick="filterNews('thema','${t.toLowerCase()}',this)">${t}</button>`).join('')}
          </div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Status</div>
          <div class="filter-tabs">
            <button class="filter-tab active" onclick="filterNewsStatus('alle',this)">Alle</button>
            <button class="filter-tab" onclick="filterNewsStatus('ungelesen',this)">Ungelesen</button>
            <button class="filter-tab" onclick="filterNewsStatus('gelesen',this)">Gelesen</button>
          </div>
        </div>
      </div>

      <div class="grid-2-3" style="align-items:start;gap:16px;">

        <div>
          <div class="section-title">Alle Meldungen</div>
          <div class="card" id="news-feed" style="padding:8px 16px;">
            ${NEWS.map(n => renderNewsItem(n)).join('')}
          </div>
        </div>

        <div>
          <div class="section-title">Quellen-Übersicht</div>
          <div class="card" style="padding:14px 16px;margin-bottom:16px;">
            ${[
              { name: 'energate messenger', color: '#ea0016', anzahl: 2, typ: 'Fachmedium' },
              { name: 'Tagesspiegel Background', color: '#0066cc', anzahl: 1, typ: 'Newsletter (privat)' },
              { name: 'Contexte Energy Briefing', color: '#8b5cf6', anzahl: 1, typ: 'Newsletter (privat)' },
              { name: 'E.ON Pressemitteilung', color: '#ea0016', anzahl: 1, typ: 'Intern' },
              { name: 'Bundestag', color: '#444', anzahl: 2, typ: 'Offiziell' },
              { name: 'BMWK / BNetzA', color: '#004B87', anzahl: 2, typ: 'Offiziell' },
              { name: 'Handelsblatt Energie', color: '#003B75', anzahl: 1, typ: 'Fachmedium' },
              { name: 'Weitere Medien', color: '#888', anzahl: 1, typ: 'Medien' },
            ].map(q => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
                <div style="display:flex;align-items:center;gap:8px;">
                  <div style="width:8px;height:8px;border-radius:50%;background:${q.color};flex-shrink:0;"></div>
                  <div>
                    <div style="font-size:12px;font-weight:500;color:var(--text-primary);">${q.name}</div>
                    <div style="font-size:10px;color:var(--text-muted);">${q.typ}</div>
                  </div>
                </div>
                <span style="font-size:11px;font-weight:600;color:var(--text-secondary);">${q.anzahl}</span>
              </div>
            `).join('')}
          </div>

          <div class="section-title">Monitoring-Themen</div>
          <div class="card" style="padding:14px 16px;">
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;">
              Aktive Suchbegriffe für automatisches Monitoring:
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${['EEG', 'Netzausbau', 'Netzpaket', 'GModG', 'Vehicle-to-Grid', 'V2G', 'Elektromobilität', 'Netzanschluss', 'Netzentgelte', 'ETS', 'Verteilnetz', 'Energiemarkt', 'BNetzA', 'E.ON', 'BMWK', 'Referentenentwurf Energie'].map(t => `
                <span class="tag tag-default" style="cursor:default;">${t}</span>
              `).join('')}
            </div>
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
              <div style="font-size:11px;color:var(--text-muted);">
                📧 Gmail-Integration: <span style="color:var(--green);">Verbunden</span> ·
                RSS-Feeds: <span style="color:var(--green);">Aktiv</span> ·
                Bundestag API: <span style="color:var(--amber);">In Einrichtung</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

function renderNewsItem(n) {
  return `
    <div class="news-item" id="news-${n.id}" style="${n.gelesen ? 'opacity:0.65;' : ''}" onclick="toggleNewsGelesen('${n.id}')">
      <div style="display:flex;flex-direction:column;gap:4px;align-items:center;flex-shrink:0;">
        <div class="news-source-dot" style="background:${n.quelleColor};"></div>
        ${!n.gelesen ? '<div style="width:6px;height:6px;border-radius:50%;background:var(--accent);"></div>' : ''}
      </div>
      <div class="news-content">
        <div class="news-title" style="${n.gelesen ? '' : 'font-weight:600;'}">${n.titel}</div>
        <div class="news-meta" style="margin-bottom:4px;">
          <span>${n.quelle}</span>
          <span>${n.datum}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.5;">${n.zusammenfassung}</div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          ${n.tags.map(tag => `<span class="news-tag">${tag.toUpperCase()}</span>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function filterNews(typ, wert, btn) {
  if (btn) {
    btn.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }

  const feed = document.getElementById('news-feed');
  if (!feed) return;

  let gefiltert = NEWS;
  if (wert !== 'alle') {
    gefiltert = NEWS.filter(n => n.tags.some(t => t.toLowerCase() === wert.toLowerCase()) || wert === 'alle');
  }
  feed.innerHTML = gefiltert.map(n => renderNewsItem(n)).join('');
}

function filterNewsStatus(status, btn) {
  if (btn) {
    btn.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }
  const feed = document.getElementById('news-feed');
  if (!feed) return;
  let gefiltert = NEWS;
  if (status === 'ungelesen') gefiltert = NEWS.filter(n => !n.gelesen);
  if (status === 'gelesen') gefiltert = NEWS.filter(n => n.gelesen);
  feed.innerHTML = gefiltert.map(n => renderNewsItem(n)).join('');
}

function toggleNewsGelesen(id) {
  const news = NEWS.find(n => n.id === id);
  if (news) news.gelesen = !news.gelesen;
  renderNews();
}

function alleAlsGelesenMarkieren() {
  NEWS.forEach(n => n.gelesen = true);
  renderNews();
}
