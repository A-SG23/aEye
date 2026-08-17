/**
 * Hash routing for three static routes.
 *
 * Deliberately not react-router: there are no params, no nesting and no data
 * loading here, so a dependency would be more surface than the thing it
 * replaces. Swap it in if the route table ever grows teeth.
 */
import { useEffect, useState } from 'react';

export const ROUTES = ['home', 'draw', 'explore'] as const;
export type Route = (typeof ROUTES)[number];

function parse(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').trim();
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'home';
}

export function navigate(route: Route): void {
  window.location.hash = route === 'home' ? '/' : `/${route}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return route;
}
