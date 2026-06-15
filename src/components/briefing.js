// ─── Briefing-Seite ───
// Rendert das strukturierte BRIEFINGS-Global (erzeugt von der Pipeline aus
// briefings/*.md) lesbar auf. Rein clientseitig, GitHub-Pages-tauglich.
// Bricht nicht, wenn noch kein Briefing vorliegt.

let _briefingIndex = 0;

function briefingData() {
  return (typeof BRIEFINGS !== 'undefined' && BRIEFINGS && Array.isArray(BRIEFINGS.all)) ? BRIEFINGS.all : [];
}

function formatBriefingDate(isoDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (isoDay || '');
}

function selectBriefing(i) {
  _briefingIndex = i;
  renderBriefing();
  const main = document.getElementById('main-content');
  if (main) main.scrollTo(0, 0);
}

function renderBriefingSpans(target, spans) {
  (spans || []).forEach(span => {
    if (span.href) {
      const a = document.createElement('a');
      a.href = span.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'briefing-link';
      a.textContent = span.text;
      target.appendChild(a);
    } else {
      target.appendChild(document.createTextNode(span.text));
    }
  });
}

function renderBriefingBlock(block) {
  if (block.kind === 'bullet') {
    const item = document.createElement('div');
    item.className = 'briefing-item';
    const dot = document.createElement('span');
    dot.className = 'briefing-bullet';
    item.appendChild(dot);
    const content = document.createElement('div');
    content.className = 'briefing-item-content';
    const main = document.createElement('div');
    renderBriefingSpans(main, block.spans);
    content.appendChild(main);
    if (block.sub) {
      const sub = document.createElement('div');
      sub.className = 'briefing-item-sub';
      sub.textContent = block.sub;
      content.appendChild(sub);
    }
    item.appendChild(content);
    return item;
  }
  const p = document.createElement('p');
  p.className = block.kind === 'note' ? 'briefing-note' : 'briefing-para';
  renderBriefingSpans(p, block.spans);
  return p;
}

function renderBriefing() {
  const el = document.getElementById('page-briefing');
  if (!el) return;
  el.innerHTML = '';
  const all = briefingData();
  if (_briefingIndex >= all.length) _briefingIndex = 0;
  const briefing = all[_briefingIndex] || null;

  // Kopfzeile
  const header = document.createElement('div');
  header.className = 'page-header';
  const left = document.createElement('div');
  left.className = 'page-header-left';
  const h1 = document.createElement('h1');
  h1.textContent = 'Briefing';
  const sub = document.createElement('p');
  sub.textContent = briefing
    ? `Tagesbriefing vom ${formatBriefingDate(briefing.date)} · automatisch aus den Quellen erzeugt`
    : 'Noch kein Briefing verfügbar';
  left.appendChild(h1);
  left.appendChild(sub);
  header.appendChild(left);
  el.appendChild(header);

  const body = document.createElement('div');
  body.className = 'page-body';
  el.appendChild(body);

  if (!briefing) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.style.cssText = 'padding:32px;text-align:center;color:var(--text-muted);';
    empty.textContent = 'Sobald die Pipeline das erste Tagesbriefing erzeugt hat, erscheint es hier.';
    body.appendChild(empty);
    return;
  }

  // Briefing-Titel
  const titleCard = document.createElement('div');
  titleCard.className = 'briefing-title';
  titleCard.textContent = briefing.title;
  body.appendChild(titleCard);

  // Abschnitte → Karten (klare visuelle Trennung der Themenblöcke)
  let card = null;
  let cardBody = null;
  const startCard = (heading) => {
    card = document.createElement('div');
    card.className = 'card briefing-section';
    if (heading) {
      const t = document.createElement('div');
      t.className = 'card-title';
      t.textContent = heading;
      card.appendChild(t);
    }
    cardBody = document.createElement('div');
    cardBody.className = 'briefing-section-body';
    card.appendChild(cardBody);
    body.appendChild(card);
  };

  (briefing.sections || []).forEach(section => {
    if (section.level === 2 || !card) {
      startCard(section.heading);
    } else if (section.level === 3 && section.heading) {
      const sh = document.createElement('div');
      sh.className = 'briefing-subheading';
      sh.textContent = section.heading;
      cardBody.appendChild(sh);
    }
    (section.blocks || []).forEach(block => cardBody.appendChild(renderBriefingBlock(block)));
  });

  // Frühere Briefings
  if (all.length > 1) {
    const archive = document.createElement('div');
    archive.className = 'card briefing-archive';
    const t = document.createElement('div');
    t.className = 'card-title';
    t.textContent = 'Frühere Briefings';
    archive.appendChild(t);
    all.forEach((b, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'briefing-archive-item' + (i === _briefingIndex ? ' active' : '');
      row.textContent = formatBriefingDate(b.date);
      row.addEventListener('click', () => selectBriefing(i));
      archive.appendChild(row);
    });
    body.appendChild(archive);
  }
}
