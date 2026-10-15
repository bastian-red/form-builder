import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Hanken_Grotesk, Lora } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';
import './build.css';
import './respond.css';

/**
 * The document, the three typefaces, and the skip link.
 *
 * **`auth()` is not called here, and must not be.** A root layout that awaits the
 * session opts every route into dynamic rendering, including the public form,
 * which has no session to read. Pages read it themselves (`lib/session.ts`).
 *
 * The faces (docs/DESIGN.md 3):
 *
 * - **Lora** asks the questions: question titles on the respond surface, form
 *   titles in the builder. A text serif with calligraphic roots, warm at display
 *   sizes, which is what a question asked by a person should feel like.
 * - **Hanken Grotesk** is every piece of chrome and every answer a respondent
 *   types. Open apertures, legible at 13px in the dense builder and at 18px on a
 *   phone.
 * - **Geist Mono** carries field ids, logic, counts in tables: where columns of
 *   digits must not shuffle and an id must read as an id.
 *
 * ONE import statement, single-quoted, on purpose. `lib/identity.test.ts` and
 * `web/scripts/identity-distinct.mjs` parse it with the same regex; split it or
 * switch to double quotes and the cross-repo check reads zero faces from this repo
 * and reports success while checking nothing.
 */
const question = Lora({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-question',
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
});

const ui = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ui',
  weight: ['400', '500', '600', '700'],
});

const mono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: { default: 'form-builder', template: '%s | form-builder' },
  description:
    'Build forms whose branching you can see, collect answers one question at a time, and read ' +
    'the results per version.',
};

/**
 * `color-scheme` makes the browser paint its own furniture (scrollbars, form
 * controls, the native date picker) in the scheme the stylesheet is using.
 */
export const viewport: Viewport = {
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${question.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        {/* First focusable element on every page. Every page renders a
            `<main id="main">`, so the target always exists. */}
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
