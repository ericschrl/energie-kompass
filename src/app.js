// ─── Energie-Kompass App ───

function switchPage(page) {
  // Deactivate all pages and nav items
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activate target
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  // Close detail panels if open
  const dp = document.getElementById('detail-panel');
  if (dp) dp.classList.remove('open');

  // Render page
  switch (page) {
    case 'dashboard':   renderDashboard();   break;
    case 'gesetze':     renderGesetze();      break;
    case 'stakeholder': renderStakeholder();  break;
    case 'news':        renderNews();         break;
    case 'kalender':    renderKalender();     break;
    case 'kontakte':    renderKontakte();     break;
  }
}

// ─── Navigation click handlers ───
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', function(e) {
    e.preventDefault();
    const page = this.dataset.page;
    switchPage(page);
  });
});

// ─── Close detail panel on backdrop click ───
document.addEventListener('click', function(e) {
  const dp = document.getElementById('detail-panel');
  if (dp && dp.classList.contains('open')) {
    if (!dp.contains(e.target) && !e.target.closest('.gesetz-karte')) {
      closeDetailPanel();
    }
  }
});

// ─── Keyboard navigation ───
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const dp = document.getElementById('detail-panel');
    if (dp && dp.classList.contains('open')) closeDetailPanel();
  }
});

// ─── Initialize ───
switchPage('dashboard');
