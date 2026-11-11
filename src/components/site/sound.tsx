"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useStored } from "@/lib/client/use-stored";

/**
 * The site's sound, synthesised in the browser with Web Audio: an ambient bed and four short cues. Nothing is
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
