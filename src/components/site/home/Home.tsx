"use client";

import { SessionRail } from "../parts";
import { HOME_CHAPTERS } from "../SiteChrome";
import { Analytics, Introducing, Mt5, Next, Problem, Psychology } from "./Acts";
import { Hero } from "./Hero";
import { Peak } from "./Peak";
import { Reveal } from "./Reveal";

/** The homepage: nine acts, scored in scrollcraft/builds/jarvis-site/BRIEF.md. */
export function Home() {
  return (
    <>
      <SessionRail chapters={HOME_CHAPTERS} />
      <Hero />
      <Problem />
      <Introducing />
      <Peak />
      <Mt5 />
      <Analytics />
      <Psychology />
      <Next />
      <Reveal />
    </>
  );
}
