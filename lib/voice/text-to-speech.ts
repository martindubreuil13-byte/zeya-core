/**
 * Text-to-Speech Utility
 * Uses ElevenLabs TTS endpoint to narrate text with Zeya's voice
 */

let currentAudioElement: HTMLAudioElement | null = null;

export async function speakText(text: string): Promise<void> {
  try {
    // Stop any currently playing audio
    if (currentAudioElement) {
      currentAudioElement.pause();
      currentAudioElement = null;
    }

    console.log("[TTS] Speaking:", text.substring(0, 100) + "...");

    const response = await fetch("/api/elevenlabs/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`TTS failed: ${error}`);
    }

    // Get audio stream and play it
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    const audio = new Audio(audioUrl);
    currentAudioElement = audio;

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudioElement = null;
        resolve();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudioElement = null;
        reject(new Error("Audio playback failed"));
      };

      audio.play().catch((err) => {
        URL.revokeObjectURL(audioUrl);
        currentAudioElement = null;
        reject(err);
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[TTS] Error:", message);
    throw error;
  }
}

export function stopSpeaking(): void {
  if (currentAudioElement) {
    currentAudioElement.pause();
    currentAudioElement = null;
  }
}

export function isSpeaking(): boolean {
  return currentAudioElement ? !currentAudioElement.paused : false;
}
