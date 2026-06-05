(function () {
  var storageKey = 'fueld-theme';

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applySavedTheme() {
    try {
      var theme = localStorage.getItem(storageKey);
      if (theme === 'light' || theme === 'dark') {
        document.documentElement.setAttribute('data-theme', theme);
      }
    } catch (_) {}
  }

  function attachToggle() {
    var button = document.querySelector('[data-theme-toggle]');
    if (!button) return;

    button.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || getSystemTheme();
      var next = current === 'dark' ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', next);

      try {
        localStorage.setItem(storageKey, next);
      } catch (_) {}
    });
  }

  applySavedTheme();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachToggle, { once: true });
    return;
  }

  attachToggle();
})();