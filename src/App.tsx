import { useState } from 'react';
import { Logo } from './components/Logo.tsx';
import { Draw } from './pages/Draw.tsx';
import { Explore } from './pages/Explore.tsx';
import { Home } from './pages/Home.tsx';
import { navigate, useRoute, type Route } from './router.ts';
import type { WingParams } from './wing.ts';
import './App.css';

const NAV: { route: Route; label: string }[] = [
  { route: 'draw', label: 'draw' },
  { route: 'explore', label: 'explore' },
];

export default function App() {
  const route = useRoute();
  // Lives here rather than in Draw so it survives navigating away and back.
  const [wingParams, setWingParams] = useState<WingParams | null>(null);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <button className="brand" onClick={() => navigate('home')} aria-current={route === 'home'}>
          <Logo scale={2} />
          <span className="wordmark">aEye</span>
        </button>
        <ul className="nav">
          {NAV.map(({ route: r, label }) => (
            <li key={r}>
              <button
                className={`nav-item ${route === r ? 'is-active' : ''}`}
                aria-current={route === r ? 'page' : undefined}
                onClick={() => navigate(r)}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="content">
        {route === 'home' && <Home />}
        {route === 'draw' && <Draw wingParams={wingParams} onWingParams={setWingParams} />}
        {route === 'explore' && <Explore />}
      </main>
    </div>
  );
}
