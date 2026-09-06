/* Bascule clair/sombre (bouton en haut à droite), mémorisée en local. */
(function (App) {
  'use strict';

  var STORAGE_KEY = 'equations-theme';

  var SUN_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="5"/>' +
    '<path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3' +
    'M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>';

  var MOON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  // Le data-theme sur <html> (posé par le script inline dans <head>, ou par un clic
  // précédent) fait foi s'il existe ; sinon on retombe sur la préférence système, déjà
  // appliquée en CSS pur par @media (prefers-color-scheme), juste pour savoir quelle
  // icône afficher.
  function currentTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Le bouton affiche l'icône du mode VERS LEQUEL on bascule (convention usuelle).
  function updateButton(btn, theme) {
    btn.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
    btn.title = theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre';
  }

  function init() {
    var btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    updateButton(btn, currentTheme());
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
      updateButton(btn, next);
    });
  }

  App.Theme = { init: init };
})(window.App = window.App || {});
