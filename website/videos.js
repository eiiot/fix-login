const videos = [...document.querySelectorAll('video')];
const [before, after] = videos;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let starting = false;

async function startTogether() {
  if (starting || reducedMotion.matches || document.hidden || videos.some(video => video.readyState < 3 || video.seeking || video.error)) return;
  starting = true;
  await Promise.allSettled(videos.map(video => video.play()));
  starting = false;
}

function pauseTogether() {
  videos.forEach(video => video.pause());
}

function restartTogether() {
  pauseTogether();
  videos.forEach(video => { video.currentTime = 0; });
  void startTogether();
}

for (const video of videos) {
  video.addEventListener('ended', () => { if (video.ended) restartTogether(); });
  video.addEventListener('waiting', pauseTogether);
  video.addEventListener('canplay', startTogether);
  video.addEventListener('seeked', startTogether);
  video.addEventListener('error', pauseTogether);
}

// Use Before as the shared clock; neither video loops independently.
before.addEventListener('timeupdate', () => {
  if (!before.paused && !after.paused && !after.seeking && Math.abs(before.currentTime - after.currentTime) > 0.05) {
    after.currentTime = before.currentTime;
  }
});

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) pauseTogether();
  else restartTogether();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseTogether();
  else restartTogether();
});
void startTogether();
