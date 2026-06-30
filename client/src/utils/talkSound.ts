// Som de notificação do Talk (Web Audio API, sem arquivo externo).
// Centralizado aqui para que exista uma única fonte de "alerta sonoro".
export function playNotificationBeep() {
  try {
    const ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )();
    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.start(start);
      osc.stop(start + dur);
    };
    const go = () => {
      play(880, ctx.currentTime, 0.18); // nota 1 — sol5
      play(1100, ctx.currentTime + 0.12, 0.22); // nota 2 — dó6 (ascendente)
      setTimeout(() => ctx.close(), 600);
    };
    ctx.state === 'suspended'
      ? ctx
          .resume()
          .then(go)
          .catch(() => {})
      : go();
  } catch {}
}
