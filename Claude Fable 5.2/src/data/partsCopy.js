// ─────────────────────────────────────────────────────────────────────────────
// data/partsCopy.js — museum-plate copy for every part of the machine.
//
//  PARTS_COPY[id] = {
//    no,          plate number (1-based, in anatomical order head → sting)
//    title,       part name (serif)
//    group,       'Head' | 'Thorax' | 'Wings' | 'Legs' | 'Abdomen'
//    roles,       material roles the part is made of (first = dominant)
//    caption,     short mono caption for the floating label (optional helper)
//    description, ≤ 2 sentences: how the mechanism is built
//    func,        one line: what it does
//    fact,        one specific, real fact about the worker of Apis mellifera
//  }
//  MATERIAL_NAMES[themeId][role] = museum-plate material wording.
//  materialLine(id, themeId) → e.g. "Smoked black glass · 24k gold".
//
// Numbers quoted here are the ones the geometry actually has (see SPEC).
// ─────────────────────────────────────────────────────────────────────────────

const P = (title, group, roles, caption, description, func, fact) => ({ title, group, roles, caption, description, func, fact });

export const PARTS_COPY = {
  // ── HEAD ──────────────────────────────────────────────────────────────────
  eyes: P('Compound Eyes', 'Head', ['eye', 'metal'], '2 × 540 lenses',
    'Two glass domes, each tiled with 540 hexagonal lenses and seated in a fitted bezel. Every lens points along its own axis, so one dome covers almost a hemisphere.',
    'Wide-field sensing of light, horizon and motion.',
    'Each eye of a worker holds about 5,500 ommatidia. She sees ultraviolet, blue and green; pure red registers as black.'),
  ocelli: P('Ocelli Triad', 'Head', ['eye', 'metal'], '3 jewel lenses',
    'Three jewel lenses in a triangle on the crown, each in a collet canted a few degrees outward from its neighbours.',
    'Reads overall brightness to hold the body level.',
    'The ocelli are focused behind their own retinas, so they form no image; they track brightness and help keep the bee level in flight.'),
  antennae: P('Antennae', 'Head', ['metal', 'body'], '10 flagellomeres',
    'A long scape, a short pedicel and a ten-segment flagellum, carried at an elbow. Ball joints between the segments let the whole whip bend freely.',
    'Touch, smell and air-vibration sensing.',
    'A worker’s flagellum has 10 segments, a drone’s 11. Johnston’s organ in the pedicel picks up the air currents of a waggle dance.'),
  mandibles: P('Mandibles', 'Head', ['metal'], 'pin-hinged pair',
    'Two spoon-shaped jaws, each turning on one hinge pin at the base of the head. Their tips meet without crossing.',
    'Grips, shapes and cuts.',
    'Worker mandibles are smooth-edged spoons for moulding wax into comb; a queen’s are notched near the tip.'),
  proboscis: P('Proboscis', 'Head', ['metal', 'body'], 'folding glossa',
    'A jointed sheath folded back under the head, with a fine glossa that slides out along it. Press P to extend it.',
    'Reaches and draws up liquid.',
    'Unfolded, a worker’s tongue reaches about 6 mm; its hairy tip laps nectar rather than sucking it through a tube.'),
  cranium: P('Cranial Housing', 'Head', ['body', 'metal'], 'glazed capsule',
    'The glazed shell that carries eyes, ocelli, antennal sockets and mouthparts, and turns on the neck as one unit.',
    'Houses and aligns every head instrument.',
    'In a young nurse bee, glands inside the head secrete most of the protein-rich jelly fed to larvae.'),

  // ── THORAX ────────────────────────────────────────────────────────────────
  scutum: P('Scutum & Scutellum', 'Thorax', ['body', 'metal'], 'flexing dorsal plates',
    'Two dorsal plates joined by a sprung seam. Tapped from below, the roof of the thorax dips and lifts, and the wing roots ride on that movement.',
    'Turns the roof’s flexing into wing stroke.',
    'Honeybee flight muscles are indirect: they beat the wings by deforming the thorax wall, not by pulling on the wings.'),
  thoraxbox: P('Thoracic Box', 'Thorax', ['body', 'metal'], 'sprung chassis',
    'Pleural side walls and a sternum plate braced into one sprung box, carrying the legs, the wing hinges and the motor.',
    'The load-bearing chassis of the machine.',
    'Before take-off a bee shivers her flight muscles with the wings disengaged, warming the thorax above 30 °C.'),
  motor: P('Resonant Flight Motor', 'Thorax', ['metal'], '230 Hz',
    'Leaf springs, a click mechanism and a crank, tuned together to resonate at 230 Hz. The springs take up each stroke and hand it back on the next, so little energy is lost.',
    'Drives the wing beat at resonance.',
    'Bee flight muscle is asynchronous: each nerve impulse yields many contractions, which is how a worker sustains about 230 beats a second.'),
  geartrain: P('Gear Train', 'Thorax', ['metal'], '42 · 14 — 30 · 12',
    'A going train in two steps. The slow 42-tooth barrel wheel drives a 14-tooth pinion; a 30-tooth wheel on the same arbor drives the 12-tooth crank pinion.',
    'Steps the barrel up 7.5 times, so the crank taps the thorax lid at wing-beat rate.',
    'To lift a heavier load a honeybee mostly widens her stroke; her beat frequency barely changes.'),
  hinges: P('Wing Hinge Assembly', 'Thorax', ['metal'], 'universal joint',
    'The axillary sclerites rebuilt as a universal joint in a rocking cradle, one per wing root: a kingpin sweeps the stroke, a fork barrel feathers the pitch, and a ball-ended link from the lid drives it.',
    'Sweeps the wing and flips it at each reversal.',
    'A honeybee strokes through an unusually short arc, about 90°, and makes up for it with a very high beat rate.'),
  setae: P('Setae', 'Thorax', ['filament'], '≈ 17,500 filaments',
    'About 17,500 fine filaments groomed into a pile on the thorax collar, the propodeum and the head, combed back and parted around every fitting.',
    'Gathers pollen and senses air.',
    'A worker’s branched hairs pick up an electrostatic charge in flight, which helps pollen grains jump to her from the flower.'),

  // ── WINGS ─────────────────────────────────────────────────────────────────
  forewings: P('Forewings', 'Wings', ['glass', 'metal'], '77 mm',
    'Etched glass panes 77 mm long, braced by metal veins that thicken toward the root, where the load is highest. The venation follows the bee’s own: one marginal cell, three submarginal.',
    'The main lifting surface.',
    'Forewing venation is consistent enough that the ratio of two vein segments, the cubital index, is used to tell honeybee subspecies apart.'),
  hindwings: P('Hindwings', 'Wings', ['glass', 'metal'], '55 mm',
    'Smaller 55 mm panes with fewer veins. In flight each one locks behind its forewing and the pair beats as a single blade.',
    'Adds area to the forewing in flight.',
    'Wing margins fray with use, so wear is a rough gauge of age: a summer forager lives only five to six weeks.'),
  hamuli: P('Hamuli Coupling', 'Wings', ['metal'], '21 hooks',
    'Twenty-one small hooks along the hindwing’s leading edge, catching a folded rim on the rear margin of the forewing. At rest the wings slide apart and the hooks let go.',
    'Locks fore- and hindwing into one surface.',
    'Worker hindwings carry about 21 hamuli. The count varies between colonies and is one of the standard measures of bee morphometry.'),

  // ── LEGS ──────────────────────────────────────────────────────────────────
  forelegs: P('Fore Legs', 'Legs', ['body', 'metal'], 'antenna cleaner',
    'The shortest pair. Each carries a semicircular notch just below a hinged spur; folded together, notch and spur close into a comb.',
    'Cleans the antennae and steadies landings.',
    'A worker cleans an antenna by drawing it through the notch on her foreleg while the spur above closes it into a ring of bristles.'),
  midlegs: P('Mid Legs', 'Legs', ['body', 'metal'], 'tibial spur',
    'Middle legs ending in a single long tibial spur. At rest they take most of the machine’s weight.',
    'Support and pollen handling.',
    'Back at the nest, a forager uses the spur on her middle leg to lever the pollen pellets out of her baskets.'),
  hindlegs: P('Hind Legs', 'Legs', ['body', 'metal'], 'pollen press',
    'The longest pair, hanging lowest in flight. A comb, a rake and a press sit at the joint below the pollen basket.',
    'Collects and carries pollen.',
    'Each hind leg combs pollen from the body; the rake of the opposite leg scrapes it off, and the press at the joint packs it up into the basket.'),
  corbicula: P('Corbicula', 'Legs', ['metal', 'filament'], 'pollen basket',
    'A concave plate on the hind tibia, ringed by curved filaments that keep the load from slipping: the machine’s cargo hold.',
    'Carries the pollen load.',
    'The real basket is a smooth hollow fringed with long hairs, with a single bristle in the middle that pins the moistened pellet.'),

  // ── ABDOMEN ───────────────────────────────────────────────────────────────
  petiole: P('Petiole', 'Abdomen', ['metal'], 'waist joint',
    'A narrow ball-and-sleeve joint between thorax and abdomen, free to pitch and swing.',
    'Lets the abdomen bend and steer.',
    'The wasp waist falls between the first and second abdominal segments; the first is fused to the thorax as the propodeum.'),
  tergites: P('Tergite Rings', 'Abdomen', ['body', 'metal'], '6 telescoping rings',
    'Six overlapping rings pierced by honeycomb windows. They telescope over one another and draw apart as the abdomen pumps.',
    'Flexible armour over the core.',
    'To guide nestmates home, workers raise the abdomen and fan scent from the Nasonov gland, which opens under the last tergite.'),
  core: P('Amber Core', 'Abdomen', ['core', 'glass', 'metal'], 'honey reactor',
    'An amber reservoir in a glass envelope, glowing through the windows of the rings and brightening as the motor runs.',
    'Stores and supplies energy.',
    'A forager carries nectar home in her honey crop, which holds around 40 mg: close to half her own weight.'),
  sting: P('Sting Assembly', 'Abdomen', ['metal'], '2 barbed lancets',
    'A tapered sheath with two barbed lancets that slide alternately along a central rail.',
    'Defence of last resort.',
    'The lancets are barbed, so in thick mammal skin the sting tears free and keeps pumping venom; from another insect she can usually withdraw it.'),
};

// Plate numbers in anatomical order.
Object.keys(PARTS_COPY).forEach((id, i) => { PARTS_COPY[id].no = i + 1; PARTS_COPY[id].id = id; });
export const PART_COUNT = Object.keys(PARTS_COPY).length;

export const MATERIAL_NAMES = {
  porcelain: {
    body: 'Glossy ivory porcelain',
    metal: '24k gold',
    glass: 'Frosted etched glass',
    eye: 'Smoked black glass',
    core: 'Amber',
    filament: 'Drawn gold filament',
  },
  delft: {
    body: 'Tin-glazed porcelain, cobalt underglaze',
    metal: 'Antique brass',
    glass: 'Etched glass',
    eye: 'Cobalt-glazed porcelain',
    core: 'Honey amber',
    filament: 'Fine brass wire',
  },
  obsidian: {
    body: 'Black lacquered enamel',
    metal: 'Aged brass',
    glass: 'Smoked etched glass',
    eye: 'Deep black glass',
    core: 'Glowing amber',
    filament: 'Aged brass filament',
  },
  codex: {
    body: 'Cream enamel',
    metal: 'Oxidised bronze',
    glass: 'Sepia-toned glass',
    eye: 'Sepia glass',
    core: 'Dark amber',
    filament: 'Bronze filament',
  },
};

/** Material line for a part in a theme, dominant role first: "Smoked black glass · 24k gold". */
export function materialLine(id, themeId) {
  const part = PARTS_COPY[id];
  const names = MATERIAL_NAMES[themeId] || MATERIAL_NAMES.porcelain;
  if (!part) return '';
  return part.roles.map((r, i) => {
    const n = names[r] || r;
    return i === 0 ? n : n.charAt(0).toLowerCase() + n.slice(1);
  }).join(' · ');
}
