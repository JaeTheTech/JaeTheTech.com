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

  /* ── GitHub Repos (Projects page) ────────────────────── */
  var repoContainer = document.getElementById('github-repos');

  if (repoContainer) {
    fetch('https://api.github.com/users/JaeTheTech/repos?sort=updated&per_page=50')
      .then(function (res) { return res.json(); })
      .then(function (repos) {
        if (!repos.length || repos.message) {
          repoContainer.innerHTML = '<div class="card"><h3>Could not load repos</h3></div>';
          return;
        }

        /* Sort: starred (hot) first, then by most recently pushed */
        repos.sort(function (a, b) {
          var scoreA = (a.stargazers_count || 0) + (a.forks_count || 0) * 2;
          var scoreB = (b.stargazers_count || 0) + (b.forks_count || 0) * 2;
          if (scoreB !== scoreA) return scoreB - scoreA;
          return new Date(b.pushed_at) - new Date(a.pushed_at);
        });

        /* Language → icon map */
        var langIcon = {
          'JavaScript': '🟨', 'TypeScript': '🔷', 'HTML': '🌐',
          'CSS': '🎨', 'Python': '🐍', 'Rust': '🦀',
          'Shell': '🐚', 'Go': '🔵', 'C#': '💜', 'Java': '☕'
        };

        var html = '';
        repos.forEach(function (repo) {
          if (repo.fork) return; /* skip forks */

          var stars = repo.stargazers_count || 0;
          var forks = repo.forks_count || 0;
          var hot = (stars + forks * 2) >= 3;
          var icon = langIcon[repo.language] || '📁';
          var pushed = new Date(repo.pushed_at);
          var ago = timeAgo(pushed);

          html += '<a href="' + repo.html_url + '" target="_blank" rel="noopener" class="card reveal visible github-repo-card" style="text-decoration:none;">';
          html += '<div class="card-icon">' + icon + '</div>';
          if (hot) html += '<span class="repo-hot">🔥 Hot</span>';
          html += '<h3>' + escapeHtml(repo.name) + '</h3>';
          html += '<p>' + escapeHtml(repo.description || 'No description') + '</p>';
          html += '<div class="repo-meta">';
          if (repo.language) html += '<span class="repo-lang">' + escapeHtml(repo.language) + '</span>';
          if (stars) html += '<span>⭐ ' + stars + '</span>';
          if (forks) html += '<span>🍴 ' + forks + '</span>';
          html += '<span>Updated ' + ago + '</span>';
          html += '</div></a>';
        });

        repoContainer.innerHTML = html || '<div class="card"><h3>No public repos yet</h3></div>';
      })
      .catch(function () {
        repoContainer.innerHTML = '<div class="card"><h3>Could not load repos</h3></div>';
      });
  }

  /* ── Auth-aware nav: show Dashboard if logged in ──────── */
  (function () {
    try {
      var data = JSON.parse(sessionStorage.getItem('jtt_auth'));
      if (!data || !data.token) return;
      var elapsed = Date.now() - data.ts;
      if (elapsed > data.ttl) return; /* expired */

      var navLinks = document.querySelector('.nav-links');
      if (!navLinks) return;

      /* Replace "Login" with "Dashboard" */
      var loginLink = navLinks.querySelector('a[href="login.html"]');
      if (loginLink) {
        loginLink.textContent = 'Dashboard';
        loginLink.href = 'dashboard.html';
      }
    } catch (e) {}
  })();

  /* ── Helpers ─────────────────────────────────────────── */
  function timeAgo(date) {
    var s = Math.floor((Date.now() - date) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
    var mo = Math.floor(d / 30); if (mo < 12) return mo + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
})();
