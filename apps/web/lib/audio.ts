const FRAME_SAMPLES = 1280;

// Runs on the audio thread: downsamples the mic to 16 kHz PCM16 in 80 ms frames.
const CAPTURE_WORKLET = `
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.out = new Int16Array(${FRAME_SAMPLES});
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const i = Math.floor(this.pos);
      const a = ch[i];
      const b = i + 1 < ch.length ? ch[i + 1] : a;
      const s = a + (b - a) * (this.pos - i);
      this.out[this.n++] = Math.max(-1, Math.min(1, s)) * 0x7fff;
      if (this.n === ${FRAME_SAMPLES}) {
        this.port.postMessage(this.out.buffer, [this.out.buffer]);
        this.out = new Int16Array(${FRAME_SAMPLES});
        this.n = 0;
      }
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor("pcm16-capture", Pcm16Capture);
`;

export type Microphone = { stop(): void };

export async function startMicrophone(
  onFrame: (frame: ArrayBuffer, level: number) => void,
): Promise<Microphone> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm16-capture");
  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) =>
    onFrame(event.data, rms(new Int16Array(event.data)));
  source.connect(node);

  return {
    stop() {
      node.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
    },
  };
}

function rms(samples: Int16Array) {
  let sum = 0;
  for (const s of samples) sum += (s / 0x7fff) ** 2;
  return Math.sqrt(sum / samples.length);
}

/** Plays agent audio gaplessly and reports when each sentence has finished playing. */
export class Player {
  private readonly ctx: AudioContext;
  private nextStart = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly chunkEnds = new Map<string, number>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor(sampleRate: number) {
    this.ctx = new AudioContext({ sampleRate });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(this.ctx.destination);
    this.samples = new Float32Array(this.analyser.fftSize);
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const s of this.samples) sum += s * s;
    return Math.sqrt(sum / this.samples.length);
  }

  enqueue(chunkId: string, pcm: ArrayBuffer) {
    const int16 = new Int16Array(pcm);
    if (int16.length === 0) return;
    const buffer = this.ctx.createBuffer(1, int16.length, this.ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) channel[i] = (int16[i] ?? 0) / 0x8000;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    const at = Math.max(this.ctx.currentTime, this.nextStart);
    source.start(at);
    this.nextStart = at + buffer.duration;
    this.chunkEnds.set(chunkId, this.nextStart);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  end(chunkId: string, onPlayed: () => void) {
    const endsAt = this.chunkEnds.get(chunkId) ?? this.ctx.currentTime;
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        this.chunkEnds.delete(chunkId);
        onPlayed();
      },
      Math.max(0, (endsAt - this.ctx.currentTime) * 1000),
    );
    this.timers.add(timer);
  }

  clear() {
    for (const source of this.sources) source.stop();
    this.sources.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.chunkEnds.clear();
    this.nextStart = 0;
  }

  close() {
    this.clear();
    void this.ctx.close();
  }
}
