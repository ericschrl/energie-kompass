function renderDashboard() {
  const aktuelleWarnungen = [
    { text: 'Stellungnahme GModG – Frist 15.06.2024 (in 3 Tagen!)', typ: 'red' },
    { text: 'Sachverständigenanhörung Netzpaket – 19.06.2024', typ: 'amber' },
    { text: 'Neue BNetzA-Konsultation Netzentgelte geöffnet', typ: 'blue' },
  ];

  const themenStatus = [
    { name: 'EEG-Novelle', phase: '1. Lesung', status: 'amber', bewegung: 'Aktiv im Bundestag' },
    { name: 'Netzausbau-Paket', phase: 'Ausschuss', status: 'amber', bewegung: 'Anhörung diese Woche' },
    { name: 'GModG', phase: 'Verbändeanhörung', status: 'red', bewegung: 'Frist läuft ab' },
    { name: 'V2G / Bidirektional', phase: 'Vorphase', status: 'green', bewegung: 'RefE erwartet Q4' },
    { name: 'Netzentgelte', phase: 'RefE in Vorbereitung', status: 'amber', bewegung: 'BNetzA-Konsultation offen' },
  ];

  const ungelesen = NEWS.filter(n => !n.gelesen).length;

  const el = document.getElementById('page-dashboard');
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Guten Morgen – Lagebild</h1>
        <p>Freitag, 14. Juni 2024 · ${ungelesen} ungelesene Meldungen</p>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" onclick="switchPage('news')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10l6 6v8a2 2 0 01-2 2z"/></svg>
          News-Monitor
        </button>
      </div>
    </div>

    <div class="page-body">

      <div class="section-title">Handlungsbedarf</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
        ${aktuelleWarnungen.map(w => `
          <div class="alert alert-${w.typ}">⚡ ${w.text}</div>
        `).join('')}
      </div>

      <div class="section-title" style="margin-top:24px;">Kennzahlen</div>
      <div class="grid-4" style="margin-bottom:24px;">
        <div class="stat-card">
          <div class="stat-label">Aktive Vorhaben</div>
          <div class="stat-value">5</div>
          <div class="stat-delta up">↑ +1 diese Woche</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Ungelesene News</div>
          <div class="stat-value">${ungelesen}</div>
          <div class="stat-delta neutral">heute morgen</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Termine diese Woche</div>
          <div class="stat-value">3</div>
          <div class="stat-delta down">davon 1 kritisch</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Offene Fristen</div>
          <div class="stat-value">2</div>
          <div class="stat-delta down">nächste in 3 Tagen</div>
        </div>
      </div>

      <div class="grid-2-3" style="gap:16px;align-items:start;">

        <div>
          <div class="section-title">Themen-Radar</div>
          <div class="card" style="padding:0;overflow:hidden;">
            <table class="data-table" style="margin:0;">
              <thead>
                <tr>
                  <th style="padding:12px 12px 10px 16px;">Vorhaben</th>
                  <th>Phase</th>
                  <th>Status</th>
                  <th>Stand</th>
                </tr>
              </thead>
              <tbody>
                ${themenStatus.map(t => `
                  <tr style="cursor:pointer;" onclick="switchPage('gesetze')">
                    <td class="td-main" style="padding-left:16px;">${t.name}</td>
                    <td>${t.phase}</td>
                    <td><span class="status status-${t.status}">${t.phase}</span></td>
                    <td style="font-size:11px;color:var(--text-muted);">${t.bewegung}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div class="section-title">Nächste Termine</div>
          <div class="card" style="padding:12px 16px;">
            ${TERMINE.slice(0,4).map(t => `
              <div class="termin-item">
                <div class="termin-date">
                  <div class="termin-day">${t.tag}</div>
                  <div class="termin-month">${t.monat}</div>
                </div>
                <div class="termin-info">
                  <div class="termin-title">${t.titel}</div>
                  <div class="termin-meta">
                    <span class="termin-type termin-type-${t.typ}">${t.typ.charAt(0).toUpperCase()+t.typ.slice(1)}</span>
                    <span>${t.uhrzeit}</span>
                    <span>${t.ort}</span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <div class="section-title">Aktuelle Meldungen</div>
          <div class="card" style="padding:12px 16px;">
            ${NEWS.slice(0,6).map(n => `
              <div class="news-item" onclick="switchPage('news')">
                <div class="news-source-dot" style="background:${n.quelleColor};"></div>
                <div class="news-content">
                  <div class="news-title${n.gelesen ? '' : ''}" style="${n.gelesen ? '' : 'font-weight:600;'}">${n.titel}</div>
                  <div class="news-meta">
                    <span>${n.quelle}</span>
                    <span>${n.datum}</span>
                    ${n.tags.map(tag => `<span class="news-tag">${tag.toUpperCase()}</span>`).join('')}
                  </div>
                </div>
              </div>
            `).join('')}
            <div style="text-align:center;padding:10px 0 2px;">
              <a class="card-action" onclick="switchPage('news')">Alle Meldungen →</a>
            </div>
          </div>
        </div>

      </div>

    </div>
  `;
}
