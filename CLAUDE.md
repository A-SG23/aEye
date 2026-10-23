# Architectural Rules for aEye (AR Eyeliner App)

- **Tech Stack:** React 19, Vite, TypeScript, Native CSS (`src/ui/styles/`). No Tailwind.
- **Project Structure:** 
  - `src/core/`: Framework-free MediaPipe camera loops, geometric calculations, and canvas overlay rendering. Keep this pure and free of React hook states or DOM elements.
  - `src/ui/`: All visual components, pages (`Home`, `Draw`, `Explore`), hooks, and styles.
- **UI Design System:** Custom high-end styling with a distinct [Green!] theme palette. Focus on a sleek, luxury cosmetic tech aesthetic rather than generic AI layouts.
- **Component & Style Constraints:**
  - Write modular, semantic classes in `src/ui/styles/App.css` or component-specific stylesheets.
  - Never use inline styling unless passing dynamic canvas/tracking coordinates.
  - Separate static layout styling from interactive elements (hover states, custom click effects).
- **Verification Commands:** `npm run typecheck` and `npm run check` must pass cleanly before completing code changes.
