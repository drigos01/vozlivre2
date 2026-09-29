// src/workers/renderHelper.worker.ts
// Web Worker for unthrottled background timers and audio FFT processing

let tickerIntervalId: any = null;

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  // Background ticker that NEVER throttles in background tabs
  if (type === 'START_TICKER') {
    if (tickerIntervalId) clearInterval(tickerIntervalId);
    tickerIntervalId = setInterval(() => {
      self.postMessage({ type: 'TICK' });
    }, payload?.intervalMs || 33);
    return;
  }

  if (type === 'STOP_TICKER') {
    if (tickerIntervalId) {
      clearInterval(tickerIntervalId);
      tickerIntervalId = null;
    }
    return;
  }

  if (type === 'PROCESS_AUDIO_FRAMES') {
    const { channelData, sampleRate, totalFrames, fps, startTime } = payload;
    const mockFreqArray: Uint8Array[] = [];

    for (let f = 0; f < totalFrames; f++) {
      const frameTime = startTime + f / fps;
      const sampleIndex = Math.floor(frameTime * sampleRate);
      const mockFreq = new Uint8Array(32);

      for (let k = 0; k < 32; k++) {
        const s = channelData[sampleIndex + k * 8] || 0;
        mockFreq[k] = Math.min(255, Math.abs(s) * 350);
      }
      mockFreqArray.push(mockFreq);
    }

    self.postMessage({
      type: 'AUDIO_FRAMES_PROCESSED',
      payload: { mockFreqArray },
    });
  }
};

export {};
