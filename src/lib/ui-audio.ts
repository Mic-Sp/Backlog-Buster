export type UISound = "welcome" | "click" | "confirm" | "pop" | "roll" | "scan";
export type SoundTheme = "cyberpunk" | "halloween";

/** Browser-only at playback time; safe to construct during SSR or in tests. */
export function createUIAudio() {
  let enabled = false;
  let theme: SoundTheme = "cyberpunk";
  let context: AudioContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  function stop() {
    generation++;
    clearTimeout(timer);
    const active = context;
    context = undefined;
    try { if (active && active.state !== "closed") void active.close().catch(() => {}); } catch { /* Optional audio. */ }
  }

  function setEnabled(value: boolean) {
    enabled = value;
    if (!enabled) stop();
  }

  function setTheme(value: SoundTheme) {
    if (theme !== value) stop();
    theme = value;
  }

  function play(sound: UISound) {
    if (!enabled || typeof window === "undefined") return;
    stop();
    const currentGeneration = generation;
    try {
      const Constructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) return;
      const audio = new Constructor();
      context = audio;
      // Even a permanently suspended/blocked context gets released promptly.
      timer = setTimeout(stop, 1200);
      function synthesize() {
        if (!enabled || generation !== currentGeneration || audio.state !== "running") return;
        try {
          const at = audio.currentTime;
          function note(frequency: number, offset: number, duration: number, type: OscillatorType, end = frequency) {
            const oscillator = audio.createOscillator();
            const envelope = audio.createGain();
            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, at + offset);
            oscillator.frequency.exponentialRampToValueAtTime(end, at + offset + duration);
            envelope.gain.setValueAtTime(0.0001, at + offset);
            envelope.gain.exponentialRampToValueAtTime(0.025, at + offset + 0.012);
            envelope.gain.exponentialRampToValueAtTime(0.0001, at + offset + duration);
            oscillator.connect(envelope);
            envelope.connect(audio.destination);
            oscillator.start(at + offset);
            oscillator.stop(at + offset + duration + 0.02);
          }
          if (theme === "cyberpunk") {
            if (sound === "click") {
              note(1800, 0, 0.035, "triangle", 1000);
            } else if (sound === "scan" || sound === "roll") {
              note(220, 0, 0.25, "sine", 1320);
              [880, 1320, 1760].forEach((frequency, index) => note(frequency, 0.2 + index * 0.065, 0.08, "triangle"));
            } else {
              [659.25, 987.77, 1318.51].forEach((frequency, index) => note(frequency, index * 0.07, 0.14, "sine"));
              if (sound === "welcome") note(2637, 0.23, 0.11, "triangle", 1318.51);
            }
          } else if (sound === "click") {
            note(440, 0, 0.055, "square", 220);
          } else if (sound === "welcome") {
            [261.63, 311.13, 392].forEach(frequency => note(frequency, 0, 0.65, "triangle", frequency * 0.97));
            note(784, 0.12, 0.55, "sine", 330);
          } else if (sound === "scan") {
            note(180, 0, 0.5, "sine", 1100);
            note(880, 0.3, 0.3, "triangle", 220);
          } else if (sound === "roll") {
            [523, 784, 659, 988, 784].forEach((frequency, index) => note(frequency, index * 0.085, 0.07, "square"));
          } else {
            note(330, 0, 0.12, "square", 990);
            note(660, 0.1, 0.13, "triangle", 330);
          }
        } catch { stop(); }
      }
      if (audio.state === "suspended") void audio.resume().then(synthesize).catch(() => { if (generation === currentGeneration) stop(); });
      else synthesize();
    } catch { stop(); }
  }

  return { setEnabled, setTheme, play, stop };
}
