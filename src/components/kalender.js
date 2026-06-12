function renderKalender() {
  const el = document.getElementById('page-kalender');

  const monateGruppiert = {};
  TERMINE.forEach(t => {
    const key = t.monat;
    if (!monateGruppiert[key]) monateGruppiert[key] = [];
    monateGruppiert[key].push(t);
  });

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Politischer Kalender</h1>
        <p>Termine, Fristen & parlamentarische Ereignisse · Jun – Jul 2024</p>
      </div>
      <div style="display:flex;gap:8px;">
        <div class="filter-tabs">
          <button class="filter-tab active" onclick="filterTermine('alle',this)">Alle</button>
          <button class="filter-tab" onclick="filterTermine('frist',this)">Fristen</button>
          <button class="filter-tab" onclick="filterTermine('anhörung',this)">Anhörungen</button>
          <button class="filter-tab" onclick="filterTermine('ausschuss',this)">Ausschuss</button>
          <button class="filter-tab" onclick="filterTermine('treffen',this)">Treffen</button>
        </div>
      </div>
    </div>

    <div class="page-body">
      <div class="grid-2" style="align-items:start;gap:16px;">

        <div>
          ${Object.entries(monateGruppiert).map(([monat, termine]) => `
            <div class="section-title">${monat === 'Jun' ? 'Juni 2024' : 'Juli 2024'}</div>
            <div class="card" style="padding:8px 16px;margin-bottom:16px;" id="termine-${monat}">
              ${termine.map(t => `
                <div class="termin-item termin-filterbar" data-typ="${t.typ}">
                  <div class="termin-date">
                    <div class="termin-day">${t.tag}</div>
                    <div class="termin-month">${t.monat}</div>
                  </div>
                  <div class="termin-info">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                      <div class="termin-title">${t.titel}</div>
                      <span class="termin-type termin-type-${t.typ}">${t.typ.charAt(0).toUpperCase()+t.typ.slice(1)}</span>
                    </div>
                    <div class="termin-meta">
                      <span>🕐 ${t.uhrzeit}</span>
                      <span>📍 ${t.ort}</span>
                    </div>
                    ${t.gesetze_ref ? `
                      <div style="margin-top:5px;">
                        <span style="font-size:10px;color:var(--accent);font-weight:500;cursor:pointer;" onclick="switchPage('gesetze')">
                          → ${GESETZE.find(g => g.id === t.gesetze_ref)?.kurz || ''}: ${GESETZE.find(g => g.id === t.gesetze_ref)?.name || ''}
                        </span>
                      </div>
                    ` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>

        <div>
          <div class="section-title">Fristen-Überblick</div>
          <div class="card" style="padding:14px 16px;margin-bottom:16px;">
            <div style="display:flex;flex-direction:column;gap:10px;">
              ${[
                { titel: 'Stellungnahme GModG', frist: '15.06.2024', dringend: true, status: 'In Bearbeitung' },
                { titel: 'Anmeldung Sachverständigenanhörung Netzpaket', frist: '17.06.2024', dringend: true, status: 'Offen' },
                { titel: 'BNetzA-Konsultation Netzentgelte', frist: '30.06.2024', dringend: false, status: 'Offen' },
                { titel: 'EEG-Änderungsanträge via BDEW', frist: '15.07.2024', dringend: false, status: 'Offen' },
              ].map(f => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);border:1px solid ${f.dringend ? 'rgba(239,68,68,0.3)' : 'var(--border)'};">
                  <div>
                    <div style="font-size:13px;font-weight:500;color:var(--text-primary);">${f.titel}</div>
                    <div style="font-size:11px;color:${f.dringend ? 'var(--red)' : 'var(--text-muted)'};margin-top:2px;">Frist: ${f.frist}</div>
                  </div>
                  <span class="status ${f.dringend ? 'status-red' : 'status-amber'}">${f.status}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="section-title">Parlamentarischer Kalender</div>
          <div class="card" style="padding:14px 16px;">
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;line-height:1.6;">
              Bundestag-Sitzungswochen Juni / Juli 2024:
            </div>
            ${[
              { kw: 'KW 24 (10.–14. Jun)', typ: 'aktiv', hinweis: 'EEG 1. Lesung geplant' },
              { kw: 'KW 25 (17.–21. Jun)', typ: 'aktiv', hinweis: 'Netzpaket Ausschuss' },
              { kw: 'KW 26 (24.–28. Jun)', typ: 'geplant', hinweis: 'Abstimmungswoche' },
              { kw: '01.–19. Jul', typ: 'pause', hinweis: 'Sommerpause' },
              { kw: 'KW 31 (29. Jul–02. Aug)', typ: 'geplant', hinweis: 'Sitzungswoche nach Pause' },
            ].map(s => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);">
                <div style="display:flex;align-items:center;gap:8px;">
                  <div style="width:6px;height:6px;border-radius:50%;background:${s.typ === 'aktiv' ? 'var(--green)' : s.typ === 'pause' ? 'var(--red)' : 'var(--amber)'};"></div>
                  <span style="font-size:12px;color:var(--text-primary);font-weight:500;">${s.kw}</span>
                </div>
                <span style="font-size:11px;color:var(--text-muted);">${s.hinweis}</span>
              </div>
            `).join('')}
          </div>
        </div>

      </div>
    </div>
  `;
}

function filterTermine(typ, btn) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.termin-filterbar').forEach(el => {
    if (typ === 'alle' || el.dataset.typ === typ) {
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  });
}
