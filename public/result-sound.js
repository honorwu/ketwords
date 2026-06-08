export function ensureResultAudioContext(state) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;

  if (!AudioContext) {
    return null;
  }

  if (!state.resultAudioContext) {
    state.resultAudioContext = new AudioContext();
  }

  if (state.resultAudioContext.state === "suspended") {
    state.resultAudioContext.resume().catch(() => {});
  }

  return state.resultAudioContext;
}


export function playResultSound(state, result) {
  const context = ensureResultAudioContext(state);

  if (!context) {
    return;
  }

  const now = context.currentTime;
  const isCorrect = result === "correct";
  const notes = isCorrect
    ? [
        { frequency: 660, start: 0, duration: 0.14, volume: 0.3 },
        { frequency: 880, start: 0.12, duration: 0.18, volume: 0.32 },
        { frequency: 1046, start: 0.28, duration: 0.16, volume: 0.28 },
      ]
    : [
        { frequency: 220, start: 0, duration: 0.22, volume: 0.34 },
        { frequency: 165, start: 0.2, duration: 0.28, volume: 0.36 },
        { frequency: 130, start: 0.46, duration: 0.26, volume: 0.3 },
      ];

  notes.forEach((note) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = isCorrect ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(note.frequency, now + note.start);
    gain.gain.setValueAtTime(0.0001, now + note.start);
    gain.gain.exponentialRampToValueAtTime(note.volume, now + note.start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + note.start);
    oscillator.stop(now + note.start + note.duration + 0.02);
  });

}


