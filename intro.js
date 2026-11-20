/* ============================================================
   INTRO CONTROLLER
   Owns dismissal of the landing screen (#introScreen). Previously this
   file targeted #introOverlay / #enterExplorerBtn / #introSkip — IDs
   that don't exist in index.html — and was never loaded, while the real
   dismiss logic lived at the bottom of script.js. It now matches the
   actual markup and is the single owner of that behaviour.
   Must load AFTER script.js (it calls map.invalidateSize()).
   ============================================================ */
(function(){
  var intro = document.getElementById('introScreen');
  if(!intro) return;

  var dismissed = false;

  function onKey(e){
    // keyboard users can jump straight in
    if(e.key === 'Enter' || e.key === ' ' || e.key === 'Escape'){
      e.preventDefault();
      dismissIntro();
    }
  }

  function dismissIntro(){
    if(dismissed) return;
    dismissed = true;
    document.removeEventListener('keydown', onKey);
    intro.classList.add('intro-hide');          // CSS fades it out (.5s)
    intro.setAttribute('aria-hidden', 'true');
    window.setTimeout(function(){
      intro.style.display = 'none';
      // the map was sized while hidden behind the intro; re-check its dimensions
      if(typeof map !== 'undefined' && map) map.invalidateSize();
    }, 500);
  }

  var enterBtn = document.getElementById('enterAppBtn');
  if(enterBtn) enterBtn.addEventListener('click', dismissIntro);
  document.addEventListener('keydown', onKey);
})();