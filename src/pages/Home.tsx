import { Logo } from '../components/Logo.tsx';
import { navigate } from '../router.ts';

export function Home() {
  return (
    <div className="home">
      <Logo scale={6} className="home-logo" />
      <h1 className="wordmark wordmark-xl">aEye</h1>
      <p className="home-lede">
        a live camera guide that draws your eyeliner wing on your own eye, so you can trace instead
        of guess.
      </p>
      <button className="btn btn-primary btn-lg" onClick={() => navigate('draw')}>
        Start drawing
      </button>
    </div>
  );
}
