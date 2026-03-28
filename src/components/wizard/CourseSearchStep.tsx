import { useState, useRef, useEffect } from 'react';

// ── golfcourseapi.com response types ─────────────────────────────────────────
// Adjust these if the actual API shape differs from what's documented at
// https://api.golfcourseapi.com/docs/api/ (requires a free account to view).
//
// Phase 1: only name, holes, par[] are used.
// Phase 2: courseRating, slopeRating, strokeIndex will be added from the tee data.

interface ApiHole {
  hole_number: number;
  par: number;
  stroke_index?: number; // Phase 2
}

interface ApiTee {
  tee_name?: string;
  course_rating?: number; // Phase 2
  slope_rating?: number;  // Phase 2
  holes?: ApiHole[];
}

interface ApiCourse {
  id: string;
  club_name: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
  holes?: number;
  tees?: ApiTee[];
}

interface ApiSearchResponse {
  courses?: ApiCourse[];
}
// ─────────────────────────────────────────────────────────────────────────────

export interface CourseSearchResult {
  name: string;
  holes: number;
  par: number[];
}

interface Props {
  value: CourseSearchResult;
  onChange: (result: CourseSearchResult) => void;
}

const API_KEY = import.meta.env.VITE_GOLF_COURSE_API_KEY as string | undefined;
const DEFAULT_HOLES = 18;
// Frozen so consumers can't accidentally mutate the module-level array
const DEFAULT_PAR = Object.freeze(Array(DEFAULT_HOLES).fill(4)) as number[];

function parseCourse(c: ApiCourse): CourseSearchResult {
  const holes = c.holes ?? c.tees?.[0]?.holes?.length ?? DEFAULT_HOLES;
  // Use the first tee's hole data for par values; fall back to par 4 per hole
  const teeHoles = c.tees?.[0]?.holes ?? [];
  const par =
    teeHoles.length > 0
      ? teeHoles
          .slice()
          .sort((a, b) => a.hole_number - b.hole_number)
          .map((h) => h.par)
      : Array(holes).fill(4);
  return { name: c.club_name, holes, par };
}

function locationLabel(c: ApiCourse): string {
  const parts = [c.location?.city, c.location?.state ?? c.location?.country].filter(Boolean);
  return parts.join(', ');
}

export function CourseSearchStep({ value, onChange }: Props) {
  const [query, setQuery] = useState(value.name);
  const [results, setResults] = useState<ApiCourse[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync query when parent resets the form (e.g. openAddCourse clears value.name)
  useEffect(() => {
    setQuery(value.name);
  }, [value.name]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Clear pending debounce on unmount to avoid stale state updates
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  function handleQueryChange(q: string) {
    setQuery(q);
    setSearchError('');

    // Always sync typed text to value.name so the Add Round button can enable.
    // If the API returns results and the user picks one, handleSelect will override this.
    onChange({ ...value, name: q });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!API_KEY || !q.trim() || q.trim().length < 3) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        // Endpoint per design doc — verify against golfcourseapi.com docs once you have a key
        const res = await fetch(
          `https://api.golfcourseapi.com/v1/search?search=${encodeURIComponent(q.trim())}`,
          { headers: { Authorization: `Bearer ${API_KEY}` } },
        );
        if (!res.ok) throw new Error(`API ${res.status}`);
        const data: ApiSearchResponse = await res.json();
        const courses = data.courses ?? [];
        setResults(courses.slice(0, 6));
        setShowDropdown(courses.length > 0);
      } catch (err) {
        setSearchError('Course search failed — enter details manually below.');
        console.error(err);
        setShowDropdown(false);
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  function handleSelect(course: ApiCourse) {
    const parsed = parseCourse(course);
    onChange(parsed);
    setQuery(course.club_name);
    setShowDropdown(false);
    setResults([]);
  }

  function handleParInput(raw: string) {
    const nums = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 3 && n <= 6);
    if (nums.length > 0) {
      onChange({ ...value, par: nums, holes: nums.length });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search field */}
      <div className="flex flex-col gap-1.5" ref={containerRef}>
        <label className="text-gray-400 text-sm font-medium">Course Name</label>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => results.length > 0 && setShowDropdown(true)}
            placeholder="Search for your course…"
            className="w-full bg-gray-800 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
          />
          {searching && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-xs">Searching…</span>
          )}

          {/* Dropdown */}
          {showDropdown && results.length > 0 && (
            <ul className="absolute z-20 w-full bg-gray-800 border border-gray-700 rounded-xl mt-1 overflow-hidden shadow-xl">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(c)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-700 transition-colors"
                  >
                    <p className="text-white text-sm font-medium">{c.club_name}</p>
                    {locationLabel(c) && (
                      <p className="text-gray-500 text-xs">{locationLabel(c)}</p>
                    )}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ name: query, holes: DEFAULT_HOLES, par: [...DEFAULT_PAR] });
                    setShowDropdown(false);
                  }}
                  className="w-full text-left px-4 py-3 text-gray-400 text-sm hover:bg-gray-700 transition-colors border-t border-gray-700"
                >
                  Enter "{query}" manually
                </button>
              </li>
            </ul>
          )}
        </div>

        {searchError && <p className="text-yellow-500 text-xs">{searchError}</p>}
        {!API_KEY && (
          <p className="text-gray-600 text-xs">
            Course search not configured — add <code className="text-gray-500">VITE_GOLF_COURSE_API_KEY</code> to enable.
          </p>
        )}
      </div>

      {/* Holes/par fields — shown once the user has typed a course name */}
      {value.name && (
        <>

          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 w-24">
              <label className="text-gray-400 text-sm font-medium">Holes</label>
              <input
                type="number"
                min={9}
                max={18}
                value={value.holes}
                onChange={(e) => {
                  const h = parseInt(e.target.value, 10);
                  if (!isNaN(h) && h >= 9 && h <= 18) {
                    onChange({ ...value, holes: h, par: Array(h).fill(4) });
                  }
                }}
                className="bg-gray-800 text-white rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-gray-400 text-sm font-medium">Par per hole (comma-separated)</label>
              <input
                type="text"
                defaultValue={value.par.join(', ')}
                onBlur={(e) => handleParInput(e.target.value)}
                placeholder="4, 3, 5, 4, 4, 3, 4, 5, 4…"
                className="bg-gray-800 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          <p className="text-gray-600 text-xs">
            Total par: {value.par.reduce((a, b) => a + b, 0)} across {value.holes} holes
          </p>
        </>
      )}
    </div>
  );
}
