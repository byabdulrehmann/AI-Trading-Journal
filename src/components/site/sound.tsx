"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStored } from "@/lib/client/use-stored";

/**
 * The site's sound, synthesised in the browser with Web Audio: an ambient bed and four short cues. Nothing is
 * downloaded and nothing plays until the visitor turns sound on; the choice is remembered per browser, but even then
 * audio only starts after the visitor's first gesture on the page, as browsers require.
 */
export type Cue = "tick" | "chapter" | "reveal" | "finale";

interface Sound {
  enabled: boolean;
  volume: number;
  setEnabled: (on: boolean) => void;
  setVolume: (v: number) => void;
  play: (cue: Cue) => void;
}

const Ctx = createContext<Sound | null>(null);

// Minimum gap per cue, so scrolling back and forth over a boundary can't machine-gun it.
const GAP: Record<Cue, number> = { tick: 120, chapter: 900, reveal: 2500, finale: 6000 };

class Engine {
  ctx: AudioContext;
  master: GainNode;
  bed: GainNode | null = null;
  bedNodes: AudioScheduledSourceNode[] = [];
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

  /** A low, slowly breathing room tone: two detuned sines and filtered air. */
  startBed() {
    if (this.bed) return;
    const t = this.ctx.currentTime;
    const bed = this.ctx.createGain();
    bed.gain.setValueAtTime(0, t);
    bed.gain.linearRampToValueAtTime(0.05, t + 3);
    bed.connect(this.master);
    for (const f of [55, 82.6, 110.3]) {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = f === 55 ? 0.5 : 0.22;
      o.connect(g).connect(bed);
      o.start();
      this.bedNodes.push(o);
    }
    const air = this.noise(4);
    air.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const depth = this.ctx.createGain();
    depth.gain.value = 160;
    lfo.connect(depth).connect(lp.frequency);
    const ag = this.ctx.createGain();
    ag.gain.value = 0.35;
    air.connect(lp).connect(ag).connect(bed);
    air.start();
    lfo.start();
    this.bedNodes.push(air, lfo);
    this.bed = bed;
  }

  stopBed() {
    if (!this.bed) return;
    const t = this.ctx.currentTime;
    this.bed.gain.cancelScheduledValues(t);
    this.bed.gain.setTargetAtTime(0, t, 0.3);
    const nodes = this.bedNodes;
    this.bedNodes = [];
    this.bed = null;
    setTimeout(() => nodes.forEach((n) => n.stop()), 1500);
  }

  play(cue: Cue) {
    const now = performance.now();
    if (now - (this.last[cue] ?? -Infinity) < GAP[cue]) return;
    this.last[cue] = now;
    const t = this.ctx.currentTime;
    const out = this.ctx.createGain();
    out.connect(this.master);
    if (cue === "tick") {
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
  const value = useMemo<Sound>(() => ({ enabled, volume, setEnabled, setVolume: (v) => setStoredVolume(String(v)), play }), [enabled, volume, setEnabled, setStoredVolume, play]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSound(): Sound {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSound needs SoundProvider");
  return s;
}
