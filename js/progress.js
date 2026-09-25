/* Progress : progression de la campagne, sauvegardée dans localStorage
   (`equations-progress`), sur le même modèle que App.Settings. Aucune donnée ne quitte
   le navigateur ; exportJSON/importJSON permettent de la déplacer à la main (voir les
   réglages). Écrite seulement à la réussite d'un niveau, jamais pendant une résolution.

   Format (version 1) :
   { version: 1,
     levels: { t1: { stars: 3, bestSteps: 1, solvedAt: '2026-09-25' }, ... },
     badges: ['premiers-pas', ...],
     daily: { date: '2026-09-25', streak: 3 },
     lastScreen: 'map' | 'free' } */
(function (App) {
  'use strict';

  var STORAGE_KEY = 'equations-progress';
  var VERSION = 1;
  var state = fresh();
  var listeners = [];

  function fresh() {
    return { version: VERSION, levels: {}, badges: [], daily: null, lastScreen: null };
  }

  function sanitize(raw) {
    var s = fresh();
    if (!raw || typeof raw !== 'object') return s;
    if (raw.levels && typeof raw.levels === 'object') {
      Object.keys(raw.levels).forEach(function (id) {
        var l = raw.levels[id];
        if (!App.Levels.get(id) || !l || typeof l.stars !== 'number') return;
        s.levels[id] = {
          stars: Math.max(1, Math.min(3, Math.round(l.stars))),
          bestSteps: typeof l.bestSteps === 'number' ? l.bestSteps : null,
          solvedAt: typeof l.solvedAt === 'string' ? l.solvedAt : null
        };
      });
    }
    if (Array.isArray(raw.badges)) {
      s.badges = raw.badges.filter(function (b) { return !!App.Levels.badge(b); });
    }
    if (raw.daily && typeof raw.daily.date === 'string') {
      s.daily = { date: raw.daily.date, streak: typeof raw.daily.streak === 'number' ? raw.daily.streak : 1 };
    }
    if (raw.lastScreen === 'map' || raw.lastScreen === 'free') s.lastScreen = raw.lastScreen;
    return s;
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) {}
    state = sanitize(raw);
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    listeners.forEach(function (fn) { fn(); });
  }

  function today() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  function isSolved(id) { return !!state.levels[id]; }

  function stars(id) { return state.levels[id] ? state.levels[id].stars : 0; }

  function totalStars() {
    return Object.keys(state.levels).reduce(function (acc, id) { return acc + state.levels[id].stars; }, 0);
  }

  function maxStars() {
    return App.Levels.LEVELS.filter(function (l) { return !l.daily; }).length * 3;
  }

  // Un niveau s'ouvre quand tous ses prérequis sont résolus (et, pour le Sommet, avec
  // assez d'étoiles). Un niveau déjà résolu reste toujours jouable.
  function isAvailable(level) {
    if (isSolved(level.id)) return true;
    if (!level.req.every(isSolved)) return false;
    return !level.stars || totalStars() >= level.stars;
  }

  // Actions déjà présentées (voir Levels.FEATURES) : celles des niveaux résolus.
  function knownFeatures() {
    var out = {};
    App.Levels.LEVELS.forEach(function (l) {
      if (isSolved(l.id)) (l.feat || []).forEach(function (f) { out[f] = true; });
    });
    return out;
  }

  function addBadge(id, earned) {
    if (state.badges.indexOf(id) !== -1) return;
    state.badges.push(id);
    earned.push(id);
  }

  // Enregistre une réussite. Renvoie { earnedBadges, unlocked, improved } : les badges
  // gagnés à l'instant, les niveaux qui viennent de s'ouvrir, et si le score s'améliore.
  function recordWin(id, result) {
    var level = App.Levels.get(id);
    if (!level) return null;
    var before = App.Levels.LEVELS.filter(isAvailable).map(function (l) { return l.id; });
    var prev = state.levels[id];
    var improved = !prev || result.stars > prev.stars;
    state.levels[id] = {
      stars: Math.max(result.stars, prev ? prev.stars : 0),
      bestSteps: prev && prev.bestSteps !== null && prev.bestSteps <= result.steps ? prev.bestSteps : result.steps,
      solvedAt: prev && prev.solvedAt ? prev.solvedAt : today()
    };
    var earned = [];
    if (level.badge) addBadge(level.badge, earned);
    if (result.badges) result.badges.forEach(function (b) { addBadge(b, earned); });
    var zoneLevels = App.Levels.LEVELS.filter(function (l) { return l.zone === level.zone && !l.daily; });
    if (zoneLevels.every(function (l) { return stars(l.id) === 3; })) addBadge('perfectionniste', earned);
    var unlocked = App.Levels.LEVELS.filter(function (l) { return isAvailable(l) && before.indexOf(l.id) === -1; })
      .map(function (l) { return l.id; });
    save();
    return { earnedBadges: earned, unlocked: unlocked, improved: improved };
  }

  // Badge hors réussite de niveau (ex. "Cartographe" au premier défi du jour).
  function awardBadge(id) {
    if (!id || !App.Levels.badge(id) || state.badges.indexOf(id) !== -1) return false;
    state.badges.push(id);
    save();
    return true;
  }

  // Défi du jour réussi : série de jours consécutifs.
  function recordDaily() {
    var d = today();
    if (state.daily && state.daily.date === d) return state.daily;
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var y = yesterday.getFullYear() + '-' + (yesterday.getMonth() < 9 ? '0' : '') + (yesterday.getMonth() + 1) + '-' +
      (yesterday.getDate() < 10 ? '0' : '') + yesterday.getDate();
    var streak = state.daily && state.daily.date === y ? state.daily.streak + 1 : 1;
    state.daily = { date: d, streak: streak };
    save();
    return state.daily;
  }

  function dailyDoneToday() { return !!state.daily && state.daily.date === today(); }

  function setLastScreen(screen) {
    if (state.lastScreen === screen) return;
    state.lastScreen = screen;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function exportJSON() {
    return JSON.stringify({ app: 'equations', exportedAt: today(), progress: state }, null, 2);
  }

  // Renvoie true si le fichier a été reconnu et chargé.
  function importJSON(text) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return false; }
    var data = raw && raw.progress ? raw.progress : raw;
    if (!data || typeof data !== 'object' || typeof data.levels !== 'object') return false;
    state = sanitize(data);
    save();
    return true;
  }

  function reset() {
    state = fresh();
    save();
  }

  load();

  App.Progress = {
    load: load,
    isSolved: isSolved,
    stars: stars,
    totalStars: totalStars,
    maxStars: maxStars,
    isAvailable: isAvailable,
    knownFeatures: knownFeatures,
    recordWin: recordWin,
    recordDaily: recordDaily,
    awardBadge: awardBadge,
    dailyDoneToday: dailyDoneToday,
    dailyStreak: function () { return state.daily ? state.daily.streak : 0; },
    badges: function () { return state.badges.slice(); },
    hasProgress: function () { return Object.keys(state.levels).length > 0; },
    lastScreen: function () { return state.lastScreen; },
    setLastScreen: setLastScreen,
    exportJSON: exportJSON,
    importJSON: importJSON,
    reset: reset,
    today: today,
    subscribe: function (fn) { listeners.push(fn); }
  };
})(window.App = window.App || {});
