async function loadMasterDb() {
  try {
    const [musicsResp, diffsResp] = await Promise.all([
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json'),
    ]);
    dbMusics = await musicsResp.json();
    dbDiffs = await diffsResp.json();
  } catch (error) {
    console.error('DB Error', error);
    showToast('楽曲DBの読み込みに失敗しました', 'warn');
  }
}
