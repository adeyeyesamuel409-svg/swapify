type Tile = { src: string; alt: string; position: string };

const TILES: Tile[] = [
  {
    src: "/swap3.jpg",
    alt: "A swapper wheeling a rail of pre-loved clothes along a brick wall",
    position: "center 35%",
  },
  {
    src: "/swap8.jpg",
    alt: "Choosing a shoe from a clothing rail at a neighbourhood swap",
    position: "center 30%",
  },
  {
    src: "/swap9.jpg",
    alt: "Wheeling a rail of clothes through the neighbourhood",
    position: "center 35%",
  },
  {
    src: "/swap10.jpg",
    alt: "Laughing with a pair of heels at a clothing swap",
    position: "center 25%",
  },
  {
    src: "/swap11.jpg",
    alt: "Hanging shoes on a rail of pre-loved clothes",
    position: "center 35%",
  },
];

/**
 * Horizontal photo filmstrip for the hero. Portrait tiles keep the photography
 * intact; the row drifts as a slow marquee on larger screens (paused on hover)
 * and becomes a swipeable scroll strip on mobile. Reduced motion stays static.
 */
export default function HeroFilmstrip() {
  const loop = [...TILES, ...TILES];

  return (
    <div className="filmstrip w-full overflow-x-auto overflow-y-hidden sm:overflow-hidden">
      <div className="film-drift flex w-max gap-4 pr-4">
        {loop.map((tile, i) => (
          <figure
            key={`${tile.src}-${i}`}
            className={`w-56 shrink-0 sm:w-64 lg:w-72 ${i % 2 === 1 ? "sm:mt-8" : ""}`}
          >
            <div className="overflow-hidden rounded-[20px] border border-line bg-surface-2 shadow-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tile.src}
                alt={tile.alt}
                width={732}
                height={1100}
                loading={i < TILES.length ? "eager" : "lazy"}
                decoding="async"
                className="aspect-[4/5] w-full object-cover"
                style={{ objectPosition: tile.position }}
              />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
