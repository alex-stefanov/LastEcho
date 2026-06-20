import { useCallback, useEffect, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import { LANGUAGES, statusAt, colorFor, type Vitality } from '../data/mockLanguages';
import { TOWNS, townStatusAt } from '../data/mockTowns';

export type LayerKind = 'lang' | 'town';
export type Layers = Record<LayerKind, boolean>;

interface Props {
  width: number;
  height: number;
  year: number;
  filters: Record<Vitality, boolean>;
  layers: Layers;
  autoRotate: boolean;
  onUserInteract: () => void;
  onSelect: (kind: LayerKind, id: number) => void;
}

const COUNTRIES_URL =
  'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl/example/datasets/ne_110m_admin_0_countries.geojson';

// A single marker payload for either layer; `key` is unique across both layers.
interface Marker {
  key: string;
  kind: LayerKind;
  id: number;
  name: string;
  lat: number;
  lng: number;
}

const LANG_MARKERS: Marker[] = LANGUAGES.map((l) => ({ key: `lang-${l.id}`, kind: 'lang', id: l.id, name: l.name, lat: l.lat, lng: l.lng }));
const TOWN_MARKERS: Marker[] = TOWNS.map((t) => ({ key: `town-${t.id}`, kind: 'town', id: t.id, name: t.name, lat: t.lat, lng: t.lng }));
const MARKERS: Marker[] = [...LANG_MARKERS, ...TOWN_MARKERS];

const LANG_BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));
const TOWN_BY_ID = new Map(TOWNS.map((t) => [t.id, t]));

// Status for a marker in a given year, regardless of which layer it belongs to.
const statusOf = (m: Marker, year: number): Vitality =>
  m.kind === 'lang' ? statusAt(LANG_BY_ID.get(m.id)!, year) : townStatusAt(TOWN_BY_ID.get(m.id)!, year);

const htmlLat = (d: any) => d.lat;
const htmlLng = (d: any) => d.lng;
// Hide markers on the far side of the globe (no bleed-through).
const visibilityModifier = (el: HTMLElement, isVisible: boolean) =>
  el.classList.toggle('behind', !isVisible);

export default function GlobeView({
  width,
  height,
  year,
  filters,
  layers,
  autoRotate,
  onUserInteract,
  onSelect,
}: Props) {
  const globeEl = useRef<any>(null);
  const els = useRef<Map<string, HTMLDivElement>>(new Map());
  const [land, setLand] = useState<any[]>([]);

  // Refs so the (stable) element builder always sees current values.
  const yearRef = useRef(year);
  yearRef.current = year;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onInteractRef = useRef(onUserInteract);
  onInteractRef.current = onUserInteract;

  useEffect(() => {
    let alive = true;
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((d) => alive && setLand(d.features ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const g = globeEl.current;
    if (!g) return;
    const c = g.controls();
    c.autoRotate = autoRotate;
    c.autoRotateSpeed = 0.32;
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.minDistance = 180;
    c.maxDistance = 520;
    c.enablePan = false;
    g.pointOfView({ lat: 12, lng: 24, altitude: 2.5 }, 0);

    // Scale markers with zoom, clamped so they always stay clickable.
    const onChange = () => {
      const dist = g.camera().position.length();
      const s = Math.min(1.55, Math.max(0.72, 360 / dist));
      document.documentElement.style.setProperty('--mscale', s.toFixed(3));
    };
    const onStart = () => onInteractRef.current(); // grabbing the globe stops rotation
    c.addEventListener('change', onChange);
    c.addEventListener('start', onStart);
    onChange();
    return () => {
      c.removeEventListener('change', onChange);
      c.removeEventListener('start', onStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to the rotation toggle.
  useEffect(() => {
    const g = globeEl.current;
    if (g) g.controls().autoRotate = autoRotate;
  }, [autoRotate]);

  // Re-color / show-hide markers per year + vitality filter + layer toggle — no DOM rebuild.
  useEffect(() => {
    for (const m of MARKERS) {
      const el = els.current.get(m.key);
      if (!el) continue;
      const s = statusOf(m, year);
      el.style.setProperty('--c', colorFor(s));
      el.classList.toggle('filtered-out', !filters[s] || !layers[m.kind]);
    }
  }, [year, filters, layers]);

  const buildElement = useCallback((d: Marker) => {
    const wrap = document.createElement('div');
    wrap.className = `lang-marker ${d.kind === 'town' ? 'town' : 'lang'}`;
    wrap.innerHTML = '<div class="lm-scale"><span class="lm-dot"></span></div><span class="lm-label"></span>';
    (wrap.querySelector('.lm-label') as HTMLElement).textContent = d.name;
    const dot = wrap.querySelector('.lm-dot') as HTMLElement;
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelectRef.current(d.kind, d.id);
    });
    els.current.set(d.key, wrap);

    const s = statusOf(d, yearRef.current);
    wrap.style.setProperty('--c', colorFor(s));
    wrap.classList.toggle('filtered-out', !filtersRef.current[s] || !layersRef.current[d.kind]);
    return wrap;
  }, []);

  return (
    <Globe
      ref={globeEl}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      globeImageUrl="https://unpkg.com/three-globe/example/img/earth-dark.jpg"
      bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
      showAtmosphere
      atmosphereColor="#3b6f9e"
      atmosphereAltitude={0.16}
      polygonsData={land}
      polygonCapColor={() => 'rgba(104, 124, 156, 0.55)'}
      polygonSideColor={() => 'rgba(104, 124, 156, 0.06)'}
      polygonStrokeColor={() => 'rgba(168, 190, 220, 0.4)'}
      polygonAltitude={0.006}
      polygonsTransitionDuration={400}
      htmlElementsData={MARKERS}
      htmlLat={htmlLat}
      htmlLng={htmlLng}
      htmlAltitude={0.012}
      htmlElement={buildElement as any}
      htmlElementVisibilityModifier={visibilityModifier}
    />
  );
}
