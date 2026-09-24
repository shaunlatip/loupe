/**
 * The starting points on the empty wall. Each is a short label that sends a
 * longer brief, and each shows off a different thing an agent that looks can
 * do: judge, rank, order, translate a feeling, carry a style somewhere new.
 * Recorded runs of each live in src/data/examples/<slug>.json (see
 * scripts/record-examples.mjs); replaying one is instant and still hands
 * over to a live conversation.
 */
export interface Example {
  slug: string;
  label: string;
  prompt: string;
}

export const EXAMPLES: Example[] = [
  {
    slug: "cats-with-opinions",
    label: "Cats with opinions",
    prompt:
      "Cats in paintings and prints that clearly have opinions: smug, plotting, deeply unimpressed. Personality over pedigree. Pick the most judgmental ones.",
  },
  {
    slug: "most-dramatic-sky",
    label: "The most dramatic sky",
    prompt:
      "Find the single most over-the-top sky in the collections, then five runners-up. Put the winner first and tell me why it wins.",
  },
  {
    slug: "tiny-people-huge-landscapes",
    label: "Tiny people, huge landscapes",
    prompt:
      "Landscapes where the people are almost too small to find. Big weather, big mountains, one tiny figure.",
  },
  {
    slug: "monsters-and-marvels",
    label: "Monsters and marvels",
    prompt:
      "Floating eyes, polite demons, fish with legs. The strangest creatures in the collections, weird but beautiful.",
  },
  {
    slug: "snacks-through-history",
    label: "Snacks through history",
    prompt:
      "Food in art across four centuries, from feasts to one suspicious oyster. Put them in date order.",
  },
  {
    slug: "hammershoi-outside",
    label: "Hammershøi, but outside",
    prompt:
      "The stillness of Hammershøi's interiors, the muted greys and the sense of someone just out of frame, but outdoors.",
  },
];
