/**
 * Original synthesized audio for TIT Campus Run.
 * Everything is generated with the Web Audio API — no copyrighted samples.
 */

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  // chase loop (pakad-mc.mp3) — plays while Nischay is in hot pursuit
  private chaseBuf: AudioBuffer | null = null;
  private chaseSrc: AudioBufferSourceNode | null = null;
  private chaseGain: GainNode | null = null;
  private chaseLoading = false;

  // game-over one-shot (kya_re_lund_ke.mp3)
  private outBuf: AudioBuffer | null = null;
  private outLoading = false;

  // after-chase playlist — 3 songs play one after another, looping, while
  // Nischay is NOT chasing (pakad-mc takes over during hot pursuit)
  private playlistUrls = [
    "dilwa-mange-gamcha.mp3",
    "bagal-wali-jaan-mareli.mp3",
    "dilwa-me-jagaha.mp3",
    "chali-samiyana-me-goli.mp3",
    "chat-deni-maar-deli.mp3",
    "500-dunga-rat-bhar-lunga.mp3",
  ];
  private plBufs: (AudioBuffer | null)[] = [];
  private plLoading: boolean[] = [];
  private plIdx = 0;
  private plWanted = false;
  private plSrc: AudioBufferSourceNode | null = null;
  private plGain: GainNode | null = null;

  /** Must be called from a user gesture (start button / first tap). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
    if (this.chaseGain) this.chaseGain.gain.value = m ? 0 : 0.55;
    if (this.plGain) this.plGain.gain.value = m ? 0 : 0.5;
  }

  /** Start the 3-song looping playlist (after Nischay backs off). */
  startPlaylist() {
    if (!this.ctx || !this.master) return;
    this.plWanted = true;
    this.ensurePlay();
  }

  /** Stop the playlist (chase started / paused / game over / menu). */
  stopPlaylist() {
    this.plWanted = false;
    if (this.plSrc) {
      const s = this.plSrc;
      this.plSrc = null;
      if (this.plGain) {
        this.plGain.disconnect();
        this.plGain = null;
      }
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
  }

  private ensurePlay() {
    if (!this.plWanted || this.plSrc || !this.ctx || !this.master) return;
    const buf = this.plBufs[this.plIdx];
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = this.muted ? 0 : 0.5;
      src.connect(gain);
      gain.connect(this.master);
      src.onended = () => {
        if (this.plSrc === src) this.plSrc = null;
        if (this.plGain) {
          this.plGain.disconnect();
          this.plGain = null;
        }
        this.plIdx = (this.plIdx + 1) % this.playlistUrls.length;
        this.ensurePlay();
      };
      src.start();
      this.plSrc = src;
      this.plGain = gain;
      return;
    }
    // current track still loading — kick the load; completion retries ensurePlay
    this.loadPlTrack(this.plIdx);
  }

  private loadPlTrack(i: number) {
    if (this.plLoading[i] || this.plBufs[i]) return;
    this.plLoading[i] = true;
    fetch(this.playlistUrls[i])
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("playlist mp3 missing: " + this.playlistUrls[i]))))
      .then((ab) => this.ctx!.decodeAudioData(ab))
      .then((b) => {
        this.plBufs[i] = b;
        this.plLoading[i] = false;
        if (this.plWanted) this.ensurePlay();
      })
      .catch(() => {
        this.plLoading[i] = false;
      });
  }

  /** Start the pakad-mc chase loop (loads the mp3 on first use). */
  startChase() {
    if (!this.ctx || !this.master || this.chaseSrc) return;
    if (this.chaseBuf) {
      this.playChaseBuf();
      return;
    }
    if (this.chaseLoading) return;
    this.chaseLoading = true;
    fetch("pakad-mc.mp3")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("chase mp3 missing"))))
      .then((ab) => this.ctx!.decodeAudioData(ab))
      .then((buf) => {
        this.chaseBuf = buf;
        this.chaseLoading = false;
        this.playChaseBuf();
      })
      .catch(() => {
        this.chaseLoading = false;
      });
  }

  /** Stop the chase loop (Nischay backed off / paused / game over). */
  stopChase() {
    if (this.chaseSrc) {
      try {
        this.chaseSrc.stop();
      } catch {
        /* already stopped */
      }
      this.chaseSrc.disconnect();
      this.chaseSrc = null;
    }
    if (this.chaseGain) {
      this.chaseGain.disconnect();
      this.chaseGain = null;
    }
  }

  private playChaseBuf() {
    if (!this.ctx || !this.master || !this.chaseBuf || this.chaseSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.chaseBuf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = this.muted ? 0 : 0.55;
    src.connect(gain);
    gain.connect(this.master);
    src.start();
    this.chaseSrc = src;
    this.chaseGain = gain;
  }

  /** Plays the game-over sound (kya_re_lund_ke.mp3) once when caught. */
  out() {
    if (!this.ctx || !this.master) return;
    if (this.outBuf) {
      this.playOutBuf();
      return;
    }
    if (this.outLoading) return;
    this.outLoading = true;
    fetch("kya_re_lund_ke.mp3")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("out mp3 missing"))))
      .then((ab) => this.ctx!.decodeAudioData(ab))
      .then((buf) => {
        this.outBuf = buf;
        this.outLoading = false;
        this.playOutBuf();
      })
      .catch(() => {
        this.outLoading = false;
        this.caught(); // fallback to the synthesized sting if the file is missing
      });
  }

  private playOutBuf() {
    if (!this.ctx || !this.master || !this.outBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.outBuf;
    const gain = this.ctx.createGain();
    gain.gain.value = this.muted ? 0 : 0.7;
    src.connect(gain);
    gain.connect(this.master);
    src.start();
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delay = 0,
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = "lowpass", delay = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  jump() {
    this.tone(320, 0.22, "square", 0.16, 640);
  }

  slide() {
    this.noise(0.3, 0.22, 900, "bandpass");
  }

  lane() {
    this.tone(520, 0.08, "triangle", 0.08, 700);
  }

  coin() {
    this.tone(1046, 0.09, "sine", 0.2);
    this.tone(1568, 0.14, "sine", 0.18, undefined, 0.06);
  }

  hit() {
    this.tone(160, 0.28, "sawtooth", 0.3, 60);
    this.noise(0.22, 0.3, 400);
  }

  chaseWarning() {
    this.tone(220, 0.32, "sawtooth", 0.22, 180);
    this.tone(220, 0.32, "sawtooth", 0.22, 180, 0.38);
  }

  step() {
    this.noise(0.035, 0.05, 1600, "lowpass");
  }

  caught() {
    const notes = [392, 330, 262, 196];
    notes.forEach((n, i) => this.tone(n, 0.26, "triangle", 0.24, n * 0.97, i * 0.16));
    this.tone(98, 0.9, "sawtooth", 0.18, 55, 0.5);
  }

  click() {
    this.tone(700, 0.06, "triangle", 0.12, 900);
  }
}
