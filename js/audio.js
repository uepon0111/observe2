'use strict';

/* ============================================================
   AUDIO ENGINE  —  再生エンジン
   ============================================================ */

const AudioEngine = (() => {
  const audio = new Audio();
  audio.preload = 'metadata';

  let ctx          = null;
  let mediaSource  = null;
  let gainNode     = null;
  let currentURL   = null;
  let loadGen      = 0;

  /* play log */
  let logStart    = null;
  let logTrackId  = null;

  /* shuffle queue */
  let shuffleQueue  = [];
  let shuffleIndex  = -1;

  /* ─── AudioContext init (user gesture 後に呼ぶ) ─── */
  async function _initCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    mediaSource = ctx.createMediaElementSource(audio);
    gainNode    = ctx.createGain();
    gainNode.gain.value = AppState.volume / 100;

    Equalizer.init(ctx);
    mediaSource.connect(gainNode);
    gainNode.connect(Equalizer.getInput());
    Equalizer.getOutput().connect(ctx.destination);

    await Equalizer.loadSettings();
  }

  /* ─── ファイル読み込み ─── */
  async function _loadTrack(trackId) {
    const gen = ++loadGen;
    const track = AppState.getTrack(trackId);
    if (!track) return false;

    if (currentURL) { URL.revokeObjectURL(currentURL); currentURL = null; }

    const buf = await Storage.getAudioFile(trackId);
    if (!buf) { Toast.error(`"${track.title}" のファイルが見つかりません`); return false; }
    if (gen !== loadGen) return false;

    currentURL = URL.createObjectURL(new Blob([buf]));
    audio.src  = currentURL;
    audio.playbackRate = AppState.playbackRate;
    AppState.setCurrentTrack(trackId);
    return true;
  }

  /* ─── 再生 ─── */
  async function play(trackId) {
    if (trackId !== undefined && trackId !== AppState.currentTrackId) {
      const ok = await _loadTrack(trackId);
      if (!ok) return;
    }
    if (!AppState.currentTrackId) return;

    await _initCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    try {
      await audio.play();
      AppState.setPlaying(true);
      _startLog();
    } catch (e) {
      console.error('Play error:', e);
      Toast.error('再生できませんでした');
    }
  }

  /* ─── 一時停止 ─── */
  function pause() {
    audio.pause();
    AppState.setPlaying(false);
    _endLog();
  }

  /* ─── 再生・停止トグル ─── */
  async function togglePlay() {
    if (AppState.isPlaying) {
      pause();
    } else {
      if (AppState.currentTrackId) {
        await play();
      } else {
        const tracks = AppState.getCurrentListTracks();
        if (tracks.length) await play(tracks[0].id);
      }
    }
  }

  /* ─── 次の曲 ─── */
  async function next(fromEnded = false) {
    _endLog();
    const tracks = AppState.getCurrentListTracks();
    if (!tracks.length) return;

    /* repeat one */
    if (AppState.repeat === 'one' && fromEnded) {
      audio.currentTime = 0;
      await audio.play();
      AppState.setPlaying(true);
      _startLog();
      return;
    }

    let nextId = null;
    if (AppState.shuffle) {
      nextId = _nextShuffle(tracks);
    } else {
      const idx = tracks.findIndex(t => t.id === AppState.currentTrackId);
      if (idx < tracks.length - 1) {
        nextId = tracks[idx + 1].id;
      } else if (AppState.repeat === 'all' || !fromEnded) {
        nextId = tracks[0].id;
      }
    }

    if (nextId) {
      await play(nextId);
    } else {
      AppState.setPlaying(false);
      audio.currentTime = 0;
    }
  }

  /* ─── 前の曲 ─── */
  async function prev() {
    _endLog();
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      if (AppState.isPlaying) { await audio.play(); _startLog(); }
      return;
    }

    const tracks = AppState.getCurrentListTracks();
    if (!tracks.length) return;

    let prevId = null;
    if (AppState.shuffle) {
      prevId = _prevShuffle(tracks);
    } else {
      const idx = tracks.findIndex(t => t.id === AppState.currentTrackId);
      prevId = idx > 0 ? tracks[idx - 1].id : tracks[tracks.length - 1].id;
    }
    if (prevId) await play(prevId);
  }

  /* ─── シーク ─── */
  function seek(pct) {
    if (!isFinite(audio.duration)) return;
    audio.currentTime = (clamp(pct, 0, 100) / 100) * audio.duration;
  }

  /* ─── 音量 ─── */
  function setVolume(v) {
    AppState.setVolume(v);
    if (gainNode) gainNode.gain.value = v / 100;
  }

  /* ─── 速度 ─── */
  function setSpeed(v) {
    AppState.setSpeed(v);
    audio.playbackRate = v;
  }

  /* ─── シャッフル ─── */
  function setShuffle(v) {
    AppState.setShuffle(v);
    if (v) _buildQueue(AppState.getCurrentListTracks());
  }

  /* ─── リピート ─── */
  function setRepeat(v) {
    AppState.setRepeat(v);
  }

  /* ─── シャッフルキュー ─── */
  function _buildQueue(tracks) {
    shuffleQueue = [...tracks].sort(() => Math.random() - 0.5);
    const cur = AppState.currentTrackId;
    if (cur) {
      const i = shuffleQueue.findIndex(t => t.id === cur);
      if (i > 0) { [shuffleQueue[0], shuffleQueue[i]] = [shuffleQueue[i], shuffleQueue[0]]; }
    }
    shuffleIndex = 0;
  }
  function _nextShuffle(tracks) {
    if (!shuffleQueue.length) _buildQueue(tracks);
    shuffleIndex++;
    if (shuffleIndex >= shuffleQueue.length) {
      if (AppState.repeat === 'all') { _buildQueue(tracks); shuffleIndex = 0; }
      else return null;
    }
    return shuffleQueue[shuffleIndex]?.id || null;
  }
  function _prevShuffle(tracks) {
    if (shuffleIndex > 0) { shuffleIndex--; return shuffleQueue[shuffleIndex]?.id || null; }
    return tracks.length ? tracks[0].id : null;
  }

  /* ─── 再生ログ ─── */
  function _startLog() {
    logStart   = Date.now();
    logTrackId = AppState.currentTrackId;
  }
  async function _endLog() {
    if (!logStart || !logTrackId) return;
    const duration = (Date.now() - logStart) / 1000;
    if (duration >= 3) {
      await Storage.addPlayLog({ id: generateId(), trackId: logTrackId, playedAt: logStart, duration });
    }
    logStart = null; logTrackId = null;
  }

  /* ─── Audio element イベント ─── */
  audio.addEventListener('timeupdate', throttle(() => {
    AppState.setProgress(audio.currentTime, isFinite(audio.duration) ? audio.duration : 0);
  }, 200));

  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('error', () => {
    AppState.setPlaying(false);
    Toast.error('再生エラーが発生しました');
  });
  audio.addEventListener('loadedmetadata', () => {
    AppState.setProgress(0, isFinite(audio.duration) ? audio.duration : 0);
  });

  /* ─── 公開 API ─── */
  return {
    play, pause, togglePlay, next, prev, seek,
    setVolume, setSpeed, setShuffle, setRepeat,
    buildShuffleQueue: (tracks) => _buildQueue(tracks || AppState.getCurrentListTracks()),
    getCtx: () => ctx,
  };
})();
