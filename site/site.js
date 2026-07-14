/* cam2qr site — shared behavior: theme toggle, tabs, tiny TS highlighter. */

/* Theme toggle. Pages with canvases listen for `cam2qr-theme` to redraw. */
(function () {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    window.dispatchEvent(new CustomEvent('cam2qr-theme'));
  });
})();

/* Mobile nav menu */
(function () {
  const btn = document.querySelector('.nav-toggle');
  const links = document.getElementById('nav-links');
  if (!btn || !links) return;
  const close = () => {
    links.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', (event) => {
    if (event.target.closest('a')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
})();

/* Tabs */
document.querySelectorAll('.tabs [role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    const tablist = tab.closest('.tabs');
    tablist.querySelectorAll('[role="tab"]').forEach((t) => {
      t.setAttribute('aria-selected', String(t === tab));
    });
    const scope = tablist.parentElement;
    scope.querySelectorAll(':scope > .tab-panel').forEach((p) => {
      p.hidden = p.dataset.panel !== tab.dataset.tab;
    });
  });
});

/* Tiny TS/Svelte/Vue highlighter — good enough for docs snippets. */
(function () {
  const TOKEN =
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|('[^'\n]*')|\b(import|from|const|let|await|async|function|return|new|if|else|for|of|in|interface|type|export|extends|while|do|continue|break|throw|try|catch|switch|case|default|null|true|false|typeof|instanceof|void|yield|readonly)\b|\b(QrScanner|QrResult|ParsedContent|Detection|Point|Segment|Uint8Array|Uint32Array|Float64Array|useQrScanner|createQrScanner|videoToElementCoordinates|decodeAll|decode|detect|listCameras|parseContent|CameraError|DecodeError|RangeError|Math|Number|TextDecoder|BitImage|BitMatrix|GrayImage|FinderPattern|OrderedPatterns|FormatInformation|Homography|Quad|BitReader|string|number|boolean)\b/g;
  document.querySelectorAll('pre.code[data-lang="ts"]').forEach((pre) => {
    const escaped = pre.textContent
      .replace(/^\n/, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    pre.innerHTML = escaped.replace(TOKEN, (match, comment, str, keyword) => {
      if (comment) return `<span class="c">${comment}</span>`;
      if (str) return `<span class="s">${str}</span>`;
      if (keyword) return `<span class="k">${keyword}</span>`;
      return `<span class="t">${match}</span>`;
    });
  });
})();
