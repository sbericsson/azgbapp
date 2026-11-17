import { useState, useRef, useEffect } from 'react';

// ── golfcourseapi.com response types ─────────────────────────────────────────
// GET /v1/search?search_query=QUERY lists courses with tee COUNTS only;
// GET /v1/courses/ID returns {course} with full tees and holes.
// Both go through /proxy/golfcourse, which adds the key.

interface ApiHole {
  par: number;
  yardage: number;
  handicap: number;
}

interface ApiTee {
  tee_name: string;
  course_rating: number;
  slope_rating: number;
  number_of_holes: number;
  par_total: number;
  holes: ApiHole[];
}

interface ApiCourseSummary {
  id: string; // e.g. "e9qqevf6"
  club_name: string;
  course_name: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
}

interface ApiCourse extends ApiCourseSummary {
  tees?: {
    male?: ApiTee[];
    female?: ApiTee[];
  };
}

interface ApiSearchResponse {
  courses?: ApiCourseSummary[];
}

interface ApiCourseResponse {
  course?: ApiCourse;
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

const DEFAULT_HOLES = 18;
// Frozen so consumers can't accidentally mutate the module-level array
const DEFAULT_PAR = Object.freeze(Array(DEFAULT_HOLES).fill(4)) as number[];

/** First tee with data: the API returns an empty list (not null) when a course has no men's tees. */
function firstTee(c: ApiCourse): ApiTee | undefined {
  return c.tees?.male?.[0] ?? c.tees?.female?.[0];
}

function courseLabel(c: ApiCourseSummary): string {
  // Use course_name when it adds info (e.g. "Oaks/Lakes"), otherwise club_name
  return c.course_name && c.course_name !== c.club_name
    ? `${c.club_name} — ${c.course_name}`
    : c.club_name;
}

function parseCourse(c: ApiCourse): CourseSearchResult {
  const tee = firstTee(c);
  const par = tee?.holes?.length ? tee.holes.map((h) => h.par) : [...DEFAULT_PAR];
  return { name: courseLabel(c), holes: par.length, par };
}

function locationLabel(c: ApiCourseSummary): string {
  const parts = [c.location?.city, c.location?.state ?? c.location?.country].filter(Boolean);
  return parts.join(', ');
}

export function CourseSearchStep({ value, onChange }: Props) {
  const [query, setQuery] = useState(value.name);
  const [results, setResults] = useState<ApiCourseSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [loadingCourse, setLoadingCourse] = useState(false);
  const selectSeq = useRef(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync query when parent resets the form (e.g. openAddCourse clears value.name).
  // Adjusting state during render avoids an extra effect-driven render.
  const [syncedName, setSyncedName] = useState(value.name);
  if (syncedName !== value.name) {
    setSyncedName(value.name);
    setQuery(value.name);
  }

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
    if (!q.trim() || q.trim().length < 3) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          // Same-origin proxy: nginx adds the API key server-side (R15)
          `/proxy/golfcourse/v1/search?search_query=${encodeURIComponent(q.trim())}`,
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

  async function handleSelect(course: ApiCourseSummary) {
    const seq = ++selectSeq.current;
    setQuery(course.club_name);
    setShowDropdown(false);
    setResults([]);
    setSearchError('');
    // Name now; holes and pars once the course details arrive
    onChange({ name: courseLabel(course), holes: DEFAULT_HOLES, par: [...DEFAULT_PAR] });
    setLoadingCourse(true);
    try {
      const res = await fetch(`/proxy/golfcourse/v1/courses/${encodeURIComponent(course.id)}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: ApiCourseResponse = await res.json();
      if (seq !== selectSeq.current) return;
      if (!data.course || !firstTee(data.course)?.holes?.length) {
        setSearchError('No hole data for this course — check the pars below.');
        return;
      }
      onChange(parseCourse(data.course));
    } catch (err) {
      if (seq !== selectSeq.current) return;
      setSearchError('Could not load the course details — check the pars below.');
      console.error(err);
    } finally {
      if (seq === selectSeq.current) setLoadingCourse(false);
    }
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
          {(searching || loadingCourse) && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{loadingCourse ? 'Loading course…' : 'Searching…'}</span>
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
                    {c.course_name && c.course_name !== c.club_name && (
                      <p className="text-green-400 text-xs">{c.course_name}</p>
                    )}
                    {locationLabel(c) && <p className="text-gray-500 text-xs">{locationLabel(c)}</p>}
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
                key={value.par.join(',')}
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
