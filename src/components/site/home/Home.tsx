"use client";

import { SessionRail } from "../parts";
import { HOME_CHAPTERS } from "../SiteChrome";
import { Analytics, Introducing, Mt5, Next, Problem, Psychology, Ribbon } from "./Acts";
import { ChartAct } from "./ChartAct";
import { Hero } from "./Hero";
import { Peak } from "./Peak";
import { Reveal } from "./Reveal";
import { WordReveals } from "../reveals";

/** The homepage: ten acts, from the first impression to early access. */
export function Home() {
  return (
    <>
      <SessionRail chapters={HOME_CHAPTERS} />
      <Hero />
      <Ribbon />
      <ChartAct />
      <Problem />
      <Introducing />
      <Peak />
      <Mt5 />
      <Analytics />
      <Psychology />
      <Next />
      <Reveal />
      <WordReveals />
    </>
  );
}
