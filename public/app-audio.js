export function waitMs(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}


export function speakEnglish(text, { rate = 0.92, cancel = true } = {}) {
  const speakText = String(text || "").trim();

  if (!speakText || !("speechSynthesis" in window)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    const utterance = new SpeechSynthesisUtterance(speakText);
    utterance.lang = "en-US";
    utterance.rate = rate;
    utterance.onend = finish;
    utterance.onerror = finish;

    if (cancel) {
      window.speechSynthesis.cancel();
    }

    window.speechSynthesis.speak(utterance);
    window.setTimeout(
      finish,
      Math.min(8000, Math.max(1600, speakText.length * 180))
    );
  });
}

export function playTermAudio(term, audioUrl) {
  const speakText = String(term || "").trim();

  if (!speakText) {
    return Promise.resolve();
  }

  if (!audioUrl) {
    return speakEnglish(speakText);
  }

  return new Promise((resolve) => {
    let settled = false;
    let fallbackStarted = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };
    const useFallback = () => {
      if (settled || fallbackStarted) {
        return;
      }

      fallbackStarted = true;
      speakEnglish(speakText).finally(finish);
    };
    const audio = new Audio(audioUrl);

    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", useFallback, { once: true });

    const playPromise = audio.play();
    if (playPromise?.catch) {
      playPromise.catch(useFallback);
    }

    window.setTimeout(finish, 4500);
  });
}


export function fallbackSpeak(text) {
  return speakEnglish(text);
}


export function getCleanSpellingText(text) {
  return String(text || "").replace(/[^a-zA-Z0-9]/g, "");
}


export function getSpellingLetters(text) {
  return getCleanSpellingText(text).split("");
}


export function getSpellingPattern(text, minInputSlots = 0) {
  const pattern = Array.from(getCleanSpellingText(text)).map((char) => ({
    type: "input",
    char,
  }));
  const inputSlots = pattern.length;

  for (let index = inputSlots; index < minInputSlots; index += 1) {
    pattern.push({ type: "input", char: "" });
  }

  return pattern;
}


export function getSpellingSpeech(text) {
  return getSpellingLetters(text)
    .map((letter) => letter.toUpperCase())
    .join(" ");
}


const SPELLING_LETTER_SPEECH = {
  a: "ay",
  b: "bee",
  c: "see",
  d: "dee",
  e: "ee",
  f: "eff",
  g: "gee",
  h: "aitch",
  i: "eye",
  j: "jay",
  k: "kay",
  l: "el",
  m: "em",
  n: "en",
  o: "oh",
  p: "pee",
  q: "cue",
  r: "ar",
  s: "ess",
  t: "tee",
  u: "you",
  v: "vee",
  w: "double you",
  x: "ex",
  y: "why",
  z: "zee",
  "-": "hyphen",
};


export function getLetterSpeechText(letter) {
  return SPELLING_LETTER_SPEECH[String(letter || "").toLowerCase()] || letter;
}


export function getLetterAudioUrl(letter) {
  const normalized = String(letter || "").toLowerCase() === "-" ? "hyphen" : String(letter || "").toLowerCase();

  if (!/^(?:[a-z]|hyphen)$/.test(normalized)) {
    return "";
  }

  return `/audio/spelling-letters/${normalized}.m4a`;
}


export function playAudioUrl(audioUrl) {
  if (!audioUrl) {
    return Promise.reject(new Error("Missing audio URL"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };
    const fail = () => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error("Audio playback failed"));
    };
    const audio = new Audio(audioUrl);

    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", fail, { once: true });

    const playPromise = audio.play();
    if (playPromise?.catch) {
      playPromise.catch(fail);
    }

    window.setTimeout(finish, 2200);
  });
}
