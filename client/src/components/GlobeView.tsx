import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import { statusAt, colorFor, type LangRecord, type Vitality } from '../data/mockLanguages';
import type { OutreachStatusSummary } from '../data/api';

interface Props {
  languages: LangRecord[];
  width: number;
  height: number;
  year: number;
  filters: Record<Vitality, boolean>;
  autoRotate: boolean;
  outreachStatus?: Record<number, OutreachStatusSummary>;
  onUserInteract: () => void;
  onSelect: (id: number) => void;
}

const COUNTRIES_URL =
  'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl/example/datasets/ne_110m_admin_0_countries.geojson';

const htmlLat = (d: any) => d.lat;
const htmlLng = (d: any) => d.lng;
// Hide markers on the far side of the globe (no bleed-through).
const visibilityModifier = (el: HTMLElement, isVisible: boolean) =>
  el.classList.toggle('behind', !isVisible);

export default function GlobeView({
  languages,
  width,
  height,
  year,
  filters,
  autoRotate,
  outreachStatus,
  onUserInteract,
  onSelect,
}: Props) {
  const globeEl = useRef<any>(null);
  const els = useRef<Map<number, HTMLDivElement>>(new Map());
  const [land, setLand] = useState<any[]>([]);

  // Marker payloads + lookup, derived from the fetched data. Rebuilt only when
  // the dataset identity changes (i.e. once, when the API responds).
  const markers = useMemo(
    () => languages.map((l) => ({ id: l.id, name: l.name, lat: l.lat, lng: l.lng })),
    [languages],
  );
  const byId = useMemo(() => new Map(languages.map((l) => [l.id, l])), [languages]);
  // Ref so the stable element builder always sees the current lookup.
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  // Refs so the (stable) element builder always sees current values.
  const yearRef = useRef(year);
  yearRef.current = year;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onInteractRef = useRef(onUserInteract);
  onInteractRef.current = onUserInteract;
  const outreachRef = useRef(outreachStatus);
  outreachRef.current = outreachStatus;

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
    // Only a real drag (or zoom) stops the auto-rotation — a plain click,
    // e.g. selecting a marker, leaves the planet spinning.
    const canvas: HTMLElement = g.renderer().domElement;
    let downX = 0;
    let downY = 0;
    let dragging = false;
    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      dragging = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (dragging || (e.buttons & 1) === 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) {
        dragging = true;
        onInteractRef.current();
      }
    };
    const onWheel = () => onInteractRef.current(); // zooming counts as interacting
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    c.addEventListener('change', onChange);
    onChange();
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('wheel', onWheel);
      c.removeEventListener('change', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to the rotation toggle.
  useEffect(() => {
    const g = globeEl.current;
    if (g) g.controls().autoRotate = autoRotate;
  }, [autoRotate]);

  // Re-color / show-hide markers per year + filter — no DOM rebuild.
  useEffect(() => {
    for (const l of languages) {
      const el = els.current.get(l.id);
      if (!el) continue;
      const s = statusAt(l, year);
      el.style.setProperty('--c', colorFor(s));
      el.classList.toggle('filtered-out', !filters[s]);
    }
  }, [languages, year, filters]);

  // Outreach ring is a separate concern from vitality color — it reflects the
  // backend sweep's own decisions, so it updates independently (e.g. once the
  // status fetch resolves, without waiting on a year/filter change).
  useEffect(() => {
    for (const l of languages) {
      const el = els.current.get(l.id);
      if (!el) continue;
      const o = outreachStatus?.[l.id];
      el.classList.toggle('has-approved', !!o?.hasApproved);
      el.classList.toggle('has-pending', !o?.hasApproved && !!o?.hasPending);
    }
  }, [languages, outreachStatus]);

  const buildElement = useCallback((d: any) => {
    const wrap = document.createElement('div');
    wrap.className = 'lang-marker';
    wrap.innerHTML = '<div class="lm-scale"><span class="lm-dot"></span></div><span class="lm-label"></span>';
    (wrap.querySelector('.lm-label') as HTMLElement).textContent = d.name;
    const dot = wrap.querySelector('.lm-dot') as HTMLElement;
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelectRef.current(d.id);
    });
    els.current.set(d.id, wrap);

    const rec = byIdRef.current.get(d.id)!;
    const s = statusAt(rec, yearRef.current);
    wrap.style.setProperty('--c', colorFor(s));
    wrap.classList.toggle('filtered-out', !filtersRef.current[s]);
    const o = outreachRef.current?.[d.id];
    wrap.classList.toggle('has-approved', !!o?.hasApproved);
    wrap.classList.toggle('has-pending', !o?.hasApproved && !!o?.hasPending);
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
      htmlElementsData={markers}
      htmlLat={htmlLat}
      htmlLng={htmlLng}
      htmlAltitude={0.012}
      htmlElement={buildElement}
      htmlElementVisibilityModifier={visibilityModifier}
    />
  );
}
