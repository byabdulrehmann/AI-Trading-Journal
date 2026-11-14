// Inline scripts that run before the first paint. They live in a plain module (no "use client") because the root
// layout, a server component, renders them: React warns about <script> tags rendered by client components.

export const SITE_THEME_KEY = "jarvis-site-theme";
export const ENTERED_KEY = "jarvis-site-entered";

/** A stored choice of light mode wins; otherwise the site and the sign-in screens open in black-and-red dark mode. */
export const SITE_THEME_SCRIPT = `try{var t=localStorage.getItem("${SITE_THEME_KEY}");document.documentElement.dataset.siteTheme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.siteTheme="dark"}`;

/** A visitor who already came in this browser session skips the entry gate without a flash. */
export const GATE_SCRIPT = `try{if(sessionStorage.getItem("${ENTERED_KEY}"))document.documentElement.dataset.entered=""}catch(e){document.documentElement.dataset.entered=""}`;
