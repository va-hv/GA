'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from './glyphs';

/** Light / dark, remembered on this device. Without a choice the device setting wins. */
export function ThemeSwitch() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const set = document.documentElement.dataset.theme;
    setDark(set ? set === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);

  function flip() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('gh-theme', next ? 'dark' : 'light'); } catch { /* private mode */ }
  }

  return (
    <button type="button" onClick={flip} aria-label={dark ? 'Use the light theme' : 'Use the dark theme'}
      className="grid h-10 w-10 place-items-center rounded-md border-2 border-rule text-ink-2 hover:border-rule-strong hover:text-ink">
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

/** Runs before the page paints, so a saved theme never flashes the wrong one. */
export const THEME_BOOT = `try{var t=localStorage.getItem('gh-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;
