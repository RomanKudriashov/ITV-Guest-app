import { useEffect, useState } from 'react';

/**
 * Ушла ли обложка из кадра.
 *
 * Признак нужен ДВОИМ — липкой полосе и переключателям, которые в неё
 * переезжают, — и потому считается один раз. Считай его каждый сам, полоса и
 * переключатели могли бы разойтись на кадр и «переезд» превратился бы в прыжок.
 *
 * ПО ВИДИМОСТИ, А НЕ ПО ЧИСЛУ ПИКСЕЛЕЙ. `IntersectionObserver` не стоит ни
 * одного кадра на прокрутке, в отличие от обработчика `scroll`, который считает
 * на каждый тик. И порог здесь смысловой: «обложка ушла» — это про обложку, а
 * не про 300 пикселей, которые завтра станут другими.
 */
export function useHeroGone(heroId: string): boolean {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const hero = document.querySelector(`[data-testid="${heroId}"]`);
    if (!hero) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setGone(!entry.isIntersecting),
      // Полоса появляется, когда от обложки осталась четверть: не в тот
      // момент, когда исчез последний её пиксель.
      { threshold: 0.25 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [heroId]);

  return gone;
}
