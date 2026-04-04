/* ═══════════════════════════════════════════════════════
   JaeTheTech.com — Scripts
   Mobile nav + scroll-reveal observer
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Mobile Nav Toggle ───────────────────────────────── */
  const toggle = document.querySelector('.nav-toggle');
  const links  = document.querySelector('.nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
    });

    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        links.classList.remove('open');
      });
    });
  }

  /* ── Scroll-Reveal (IntersectionObserver) ────────────── */
  var reveals = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && reveals.length) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    reveals.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    /* Fallback — show everything immediately */
    reveals.forEach(function (el) {
      el.classList.add('visible');
    });
  }

  /* ── Tabs (Platforms page) ───────────────────────────── */
  var tabs = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.tab-panel');

  if (tabs.length && panels.length) {
    function activateTab(name) {
      tabs.forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-tab') === name);
      });
      panels.forEach(function (p) {
        var isActive = p.id === 'tab-' + name;
        p.classList.toggle('active', isActive);
        /* Re-trigger reveal for newly visible cards */
        if (isActive) {
          p.querySelectorAll('.reveal:not(.visible)').forEach(function (el) {
            el.classList.add('visible');
          });
        }
      });
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var name = t.getAttribute('data-tab');
        activateTab(name);
        history.replaceState(null, '', '#tab-' + name);
      });
    });

    /* Deep-link from hash (e.g. platforms.html#tab-linux) */
    var hash = window.location.hash.replace('#tab-', '');
    if (hash && document.getElementById('tab-' + hash)) {
      activateTab(hash);
    }
  }
})();
