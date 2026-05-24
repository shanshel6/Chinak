let audioInterval: number | null = null;
let audioTimeout: number | null = null;

export const playOrderSound = () => {
  // Clear any existing sound intervals
  stopOrderSound();

  const play = () => {
    // Using a loud notification sound from a public CDN.
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.volume = 1.0;
    audio.play().catch(e => console.error("Error playing sound:", e));
    
    // Also try to speak it if supported
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance("New order received!");
      utterance.lang = 'en-US';
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Initial play
  play();

  // Beep every 3 seconds for 30 seconds
  audioInterval = window.setInterval(play, 3000);

  // Stop after 30 seconds
  audioTimeout = window.setTimeout(() => {
    stopOrderSound();
  }, 30000);
};

export const stopOrderSound = () => {
  if (audioInterval) {
    clearInterval(audioInterval);
    audioInterval = null;
  }
  if (audioTimeout) {
    clearTimeout(audioTimeout);
    audioTimeout = null;
  }
};
