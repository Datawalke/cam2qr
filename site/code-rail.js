/* "How it works" code rail: shows each stage's real source excerpt beside the
   prose. Wide screens get a sticky panel that follows the reader; narrow
   screens get a fold under each figure. Data comes from snippets.js, which is
   generated from src/ by scripts/extract-snippets.mjs, so the code shown here
   is always the code that ships. Must run before site.js so the excerpts get
   picked up by its highlighter. */
(function () {
  const data = window.CAM2QR_SNIPPETS;
  const rail = document.querySelector('.code-rail');
  if (!data || !rail) return;

  const GITHUB = 'https://github.com/Datawalke/cam2qr/blob/main/';
  const sections = Array.from(document.querySelectorAll('section[data-snippet]'));
  const panels = new Map();

  function makeCode(snippet) {
    const pre = document.createElement('pre');
    pre.className = 'code';
    pre.dataset.lang = 'ts';
    pre.textContent = snippet.code;
    return pre;
  }

  for (const section of sections) {
    const snippet = data[section.dataset.snippet];
    if (!snippet) continue;
    const num = section.querySelector('.num')?.textContent ?? '';
    const lastLine = snippet.line + snippet.code.split('\n').length - 1;
    const href = `${GITHUB}${snippet.file}#L${snippet.line}-L${lastLine}`;

    // Sticky rail panel (wide screens).
    const panel = document.createElement('div');
    panel.className = 'rail-panel';
    const meta = document.createElement('div');
    meta.className = 'rail-meta';
    const label = document.createElement('span');
    label.textContent = `${num} · ${snippet.file}`;
    const link = document.createElement('a');
    link.href = href;
    link.textContent = 'view on GitHub';
    meta.append(label, link);
    panel.append(meta, makeCode(snippet));
    rail.append(panel);
    panels.set(section, panel);

    // Collapsible fold (narrow screens).
    const fold = document.createElement('details');
    fold.className = 'snippet-fold';
    const summary = document.createElement('summary');
    summary.textContent = `show the source · ${snippet.file}`;
    fold.append(summary, makeCode(snippet));
    const figure = section.querySelector('canvas.viz');
    if (figure) figure.after(fold);
    else section.append(fold);
  }

  let active = null;
  function activate(section) {
    const panel = panels.get(section);
    if (!panel || panel === active) return;
    active?.classList.remove('active');
    active = panel;
    panel.classList.add('active');
  }

  // A section becomes "current" while it overlaps the reading band near the
  // top of the viewport; the panel keeps the last current section between.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activate(entry.target);
      }
    },
    { rootMargin: '-20% 0px -65% 0px' },
  );
  for (const section of panels.keys()) observer.observe(section);
  if (sections.length > 0) activate(sections[0]);
})();
