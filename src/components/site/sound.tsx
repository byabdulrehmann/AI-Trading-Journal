"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useStored } from "@/lib/client/use-stored";

/**
 * The site's sound, synthesised in the browser with Web Audio: an original generative score and short cues. Nothing is
 * downloaded and nothing plays until the visitor turns sound on; the choice is remembered per browser, but even then
 * audio only starts after the visitor's first gesture on the page, as browsers require.
 */
export type Cue = "tick" | "hover" | "click" | "nav" | "power" | "data" | "chapter" | "reveal" | "finale";

interface Sound {
  enabled: boolean;
  volume: number;
  setEnabled: (on: boolean) => void;
  setVolume: (v: number) => void;
  play: (cue: Cue) => void;
}

const Ctx = createContext<Sound | null>(null);

// Minimum gap per cue, so scrolling back and forth over a boundary can't machine-gun it.
const GAP: Record<Cue, number> = { tick: 120, hover: 70, click: 60, nav: 500, power: 4000, data: 2000, chapter: 900, reveal: 2500, finale: 6000 };

class Engine {
  ctx: AudioContext;
  master: GainNode;
  last: Partial<Record<Cue, number>> = {};

  constructor(volume: number) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = volume;
    this.master.connect(this.ctx.destination);
  }

  noise(seconds: number) {
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * seconds), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  score: { timer: ReturnType<typeof setInterval>; nodes: AudioNode[]; voices: AudioScheduledSourceNode[] } | null = null;

  /** A synthetic hall: decaying stereo noise as the impulse response, so the score has space without any file. */
  hall(seconds = 3.2) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const c = this.ctx.createConvolver();
    c.buffer = ir;
    return c;
  }

  /**
   * The score: an original, endless piece written for the site. Four lush chords (Dmaj9, Bm9, Gmaj9, Asus) change
   * every eight seconds under soft detuned pads and a quiet bass, while a glass-bell arpeggio picks chord tones at
   * random, so it never loops audibly. Everything runs through one bus into the hall.
   */
  startBed() {
    if (this.score) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.05;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, t0);
    bus.gain.linearRampToValueAtTime(0.22, t0 + 4);
    const dry = ctx.createGain();
    dry.gain.value = 0.65;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    const hall = this.hall();
    bus.connect(dry).connect(this.master);
    bus.connect(hall).connect(wet).connect(this.master);
    // Pads sit under a slowly breathing low-pass, so the chords swell and darken rather than buzz.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 1100;
    tone.Q.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const depth = ctx.createGain();
    depth.gain.value = 420;
    lfo.connect(depth).connect(tone.frequency);
    lfo.start(t0);
    tone.connect(bus);

    const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
    const CHORDS = [
      [50, 54, 57, 61, 64],
      [47, 50, 54, 57, 61],
      [43, 47, 50, 54, 57],
      [45, 50, 52, 54, 59],
    ];
    const BAR = 8;
    const voices: AudioScheduledSourceNode[] = [lfo];
    const hold = (o: AudioScheduledSourceNode) => {
      voices.push(o);
      o.onended = () => voices.splice(voices.indexOf(o), 1);
    };

    const chordAt = (at: number, notes: number[]) => {
      for (const n of notes) {
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, at);
        env.gain.exponentialRampToValueAtTime(0.05, at + 2.6);
        env.gain.setValueAtTime(0.05, at + BAR - 0.4);
        env.gain.exponentialRampToValueAtTime(0.0001, at + BAR + 3);
        env.connect(tone);
        for (const cents of [-7, 6]) {
          const o = ctx.createOscillator();
          o.type = "triangle";
          o.frequency.value = hz(n);
          o.detune.value = cents;
          o.connect(env);
          o.start(at);
          o.stop(at + BAR + 3.2);
          hold(o);
        }
      }
      const bass = ctx.createOscillator();
      const benv = ctx.createGain();
      bass.frequency.value = hz(notes[0] - 12);
      benv.gain.setValueAtTime(0.0001, at);
      benv.gain.exponentialRampToValueAtTime(0.09, at + 1.2);
      benv.gain.exponentialRampToValueAtTime(0.0001, at + BAR + 1);
      bass.connect(benv).connect(bus);
      bass.start(at);
      bass.stop(at + BAR + 1.2);
      hold(bass);
    };

    const bell = (at: number, midi: number) => {
      const o = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const env = ctx.createGain();
      o.type = "sine";
      o.frequency.value = hz(midi);
      // A quiet partial a twelfth up gives the glass its ring.
      o2.type = "sine";
      o2.frequency.value = hz(midi) * 3;
      const p2 = ctx.createGain();
      p2.gain.value = 0.18;
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.045, at + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 2.2);
      o.connect(env);
      o2.connect(p2).connect(env);
      env.connect(bus);
      for (const x of [o, o2]) {
        x.start(at);
        x.stop(at + 2.3);
        hold(x);
      }
    };

    // A look-ahead scheduler: every 200 ms it books whatever falls in the next second.
    let bar = 0;
    let nextBar = t0;
    let nextStep = t0 + 1;
    const STEP = 0.375;
    const tick = () => {
      const horizon = ctx.currentTime + 1;
      while (nextBar < horizon) {
        chordAt(nextBar, CHORDS[bar % CHORDS.length]);
        bar++;
        nextBar += BAR;
      }
      while (nextStep < horizon) {
        const chord = CHORDS[Math.floor((nextStep - t0) / BAR) % CHORDS.length];
        if (Math.random() < 0.42) bell(nextStep, chord[Math.floor(Math.random() * chord.length)] + (Math.random() < 0.7 ? 12 : 24));
        nextStep += STEP;
      }
    };
    tick();
    this.score = { timer: setInterval(tick, 200), nodes: [bus, dry, wet, hall, tone, depth], voices };
  }

  stopBed() {
    if (!this.score) return;
    const { timer, nodes, voices } = this.score;
    this.score = null;
    clearInterval(timer);
    const bus = nodes[0] as GainNode;
    const t = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(0, t, 0.4);
    setTimeout(() => {
      for (const v of [...voices]) {
        try {
          v.stop();
        } catch {
          // already stopped
        }
      }
      nodes.forEach((n) => n.disconnect());
    }, 2000);
  }

  play(cue: Cue) {
    const now = performance.now();
    if (now - (this.last[cue] ?? -Infinity) < GAP[cue]) return;
    this.last[cue] = now;
    const t = this.ctx.currentTime;
    const out = this.ctx.createGain();
    out.connect(this.master);
    // A short pitched blip: the building block of the small cues.
    const blip = (type: OscillatorType, from: number, to: number, peak: number, len: number, at = t) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(from, at);
      o.frequency.exponentialRampToValueAtTime(to, at + len * 0.8);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + len + 0.02);
    };
    if (cue === "hover") {
      blip("sine", 2400, 2050, 0.016, 0.045);
    } else if (cue === "click") {
      blip("triangle", 420, 170, 0.06, 0.07);
    } else if (cue === "data") {
      [880, 1108.7, 1318.5].forEach((f, i) => blip("sine", f, f, 0.03, 0.22, t + i * 0.06));
    } else if (cue === "nav") {
      const n = this.noise(0.4);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 2;
      bp.frequency.setValueAtTime(2400, t);
      bp.frequency.exponentialRampToValueAtTime(420, t + 0.32);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.05, t + 0.06);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      n.connect(bp).connect(out);
      n.start(t);
      n.stop(t + 0.4);
    } else if (cue === "power") {
      // Sound switched on: a low swell rising an octave under a soft fifth, the hero's reveal in sound.
      const sub = this.ctx.createOscillator();
      sub.frequency.setValueAtTime(55, t);
      sub.frequency.exponentialRampToValueAtTime(110, t + 1.1);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.09, t + 0.5);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      sub.connect(out);
      sub.start(t);
      sub.stop(t + 2.5);
      [440, 659.3].forEach((f, i) => blip("triangle", f, f, 0.025, 1.8, t + 0.35 + i * 0.12));
    } else if (cue === "tick") {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.07, t + 0.004);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(out);
      o.start(t);
      o.stop(t + 0.08);
    } else if (cue === "chapter") {
      const n = this.noise(0.6);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(2200, t + 0.45);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.09, t + 0.12);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      n.connect(bp).connect(out);
      n.start(t);
      n.stop(t + 0.6);
    } else {
      // A struck bell for the peak; a slow minor-ninth chord for the close.
      const notes = cue === "reveal" ? [659.3, 987.8, 1318.5] : [220, 261.6, 329.6, 392, 493.9];
      const attack = cue === "reveal" ? 0.01 : 0.9;
      const decay = cue === "reveal" ? 1.6 : 4.2;
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(cue === "reveal" ? 0.08 : 0.07, t + attack);
      out.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      notes.forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.value = 1 / (i + 1.5);
        o.connect(g).connect(out);
        o.start(t + (cue === "finale" ? i * 0.09 : 0));
        o.stop(t + attack + decay + 0.2);
      });
    }
  }
}

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useStored("jarvis-site-sound", "off");
  const [storedVolume, setStoredVolume] = useStored("jarvis-site-volume", "0.6");
  const enabled = stored === "on";
  const volume = Math.min(1, Math.max(0, Number(storedVolume) || 0));
  const engine = useRef<Engine | null>(null);
  const [gesture, setGesture] = useState(false);

  // Browsers only let audio start from a gesture; until then a remembered "on" waits silently.
  useEffect(() => {
    if (gesture) return;
    const mark = () => setGesture(true);
    window.addEventListener("pointerdown", mark, { once: true });
    window.addEventListener("keydown", mark, { once: true });
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
    };
  }, [gesture]);

  useEffect(() => {
    if (!enabled || !gesture) {
      engine.current?.stopBed();
      return;
    }
    if (!engine.current) engine.current = new Engine(volume);
    const e = engine.current;
    void e.ctx.resume();
    e.startBed();
    const onHide = () => (document.hidden ? void e.ctx.suspend() : void e.ctx.resume());
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
    // volume is applied in its own effect, so changing it doesn't restart the bed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, gesture]);

  useEffect(() => {
    const e = engine.current;
    if (e) e.master.gain.setTargetAtTime(volume, e.ctx.currentTime, 0.05);
  }, [volume]);

  useEffect(() => () => void engine.current?.ctx.close(), []);

  const setEnabled = useCallback(
    (on: boolean) => {
      setGesture(true);
      setStored(on ? "on" : "off");
    },
    [setStored],
  );
  const play = useCallback(
    (cue: Cue) => {
      if (!enabled || !gesture || !engine.current) return;
      if (cue === "chapter" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      engine.current.play(cue);
    },
    [enabled, gesture],
  );
  // Hover and click cues come from one listener each, so no control has to wire its own sound.
  useEffect(() => {
    if (!enabled || !gesture) return;
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !(e.target instanceof Element)) return;
      const el = e.target.closest(".s-btn, header a, header button, [data-sound=hover]");
      if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) play("hover");
    };
    const click = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("a[href], button, [role=button], summary")) play("click");
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("click", click, true);
    };
  }, [enabled, gesture, play]);

  // Moving between pages gets a soft sweep; the first page load doesn't.
  const path = usePathname();
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    play("nav");
  }, [path, play]);

  const value = useMemo<Sound>(() => ({ enabled, volume, setEnabled, setVolume: (v) => setStoredVolume(String(v)), play }), [enabled, volume, setEnabled, setStoredVolume, play]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSound(): Sound {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSound needs SoundProvider");
  return s;
}
