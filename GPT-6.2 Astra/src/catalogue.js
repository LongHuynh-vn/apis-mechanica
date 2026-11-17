// Captions identify the fabrication in the exhibit. Facts describe the living worker.
export const catalogue = {
  eyes: [
    'Compound Eyes',
    'Smoked glass · faceted optics',
    'Individually seated hexagonal lenses collect light across two compound domes.',
    'A worker’s compound eye assembles its view from thousands of ommatidia.',
  ],
  ocelli: [
    'Ocelli Triad',
    'Crown optics · 3 jewels',
    'Three polished jewels sample the horizon above the cranial housing.',
    'The three simple eyes sit in a triangle between the compound eyes.',
  ],
  antennae: [
    'Antennae',
    'Gold pin joints · 10 flagellomeres',
    'An elbowed scape carries a pedicel and ten articulated sensory segments.',
    'A worker has ten flagellar segments beyond the scape and pedicel.',
  ],
  mandibles: [
    'Mandibles',
    'Paired bronze jaws',
    'Two curved, opposed jaws pivot independently beneath the face.',
    'Worker bees use their mandibles to shape wax when building comb.',
  ],
  proboscis: [
    'Proboscis',
    'Telescoping glossa',
    'A nested gilt tongue unfolds from the labial sheath.',
    'A honeybee laps nectar with the hairy tip of its tongue.',
  ],
  head: [
    'Cranial Housing',
    'Glazed cranial plates',
    'A curved faceplate protects the optical mounts and the head’s stabilizing pivot.',
    'The articulated neck allows the head to stay level as the thorax rolls.',
  ],
  scutum: [
    'Scutum & Scutellum',
    'Glazed dorsal plates',
    'Two vaulted plates close the spring box. Their minute deflection drives the wing hinges.',
    'The scutum and scutellum form much of the upper surface of the flight thorax.',
  ],
  motor: [
    'Resonant Flight Motor',
    'Sprung brass · 24:16:12 train',
    'A crank and paired leaf springs flex the thoracic box between two opposing strokes.',
    'Indirect flight muscles move the wings by deforming the thorax.',
  ],
  hinge: [
    'Wing Hinge Assembly',
    'Axillary gimbal · two axes',
    'A pinned rocker couples thoracic flexion to sweeping and pitching motions.',
    'Small axillary sclerites transmit motion between the thorax and wing base.',
  ],
  setae: [
    'Setae',
    'Drawn gold filaments',
    'Fine tapered filaments follow the collar and the rear edge of the head.',
    'A honeybee’s branched body hairs help catch pollen.',
  ],
  forewing: [
    'Forewings',
    'Etched thin-film glass',
    'A gilt costa frames the long marginal cell and three submarginal cells.',
    'Forewing vein junctions help researchers distinguish honeybee populations.',
  ],
  hindwing: [
    'Hindwings',
    'Etched glass · aft aerofoil',
    'A smaller glass membrane couples to the trailing edge of each forewing.',
    'The forewing and hindwing on each side work together during flight.',
  ],
  hamuli: [
    'Hamuli Coupling',
    '21 hooks per side',
    'A line of sprung hooks fastens the two membranes into a single aerofoil.',
    'The hindwing hooks catch a folded edge on the forewing.',
  ],
  legs: [
    'Articulated Legs',
    'Six chains · five tarsomeres',
    'Pinned coxae, trochanters, femora and tibiae carry segmented feet with paired claws.',
    'A worker’s forelegs carry an antennal cleaning apparatus.',
  ],
  basket: [
    'Corbicula',
    'Concave plate · curved filaments',
    'A polished depression on each hind tibia is enclosed by a fringe of brass filaments.',
    'Workers pack moistened pollen into baskets on their hind tibiae.',
  ],
  petiole: [
    'Petiole',
    'Waist bearing · bronze bellows',
    'A narrow bearing suspends the abdomen and allows it to lag behind the thorax.',
    'The narrow waist gives the abdomen considerable freedom to move.',
  ],
  rings: [
    'Tergite Rings',
    'Six telescoping shells',
    'Overlapping glazed shells slide on annular guides around the reactor.',
    'Six abdominal tergites are externally visible in a worker honeybee.',
  ],
  core: [
    'Amber Core',
    'Amber glass · honeycomb ports',
    'A warm amber reservoir is visible through hexagonal openings in the tergites.',
    'A bee carries nectar home in a specialized crop, often called its honey stomach.',
  ],
  sting: [
    'Sting Assembly',
    'Sheath & twin lancets',
    'Two fine barbed lancets slide against a central guide within a tapered sheath.',
    'A worker sting has two lancets that move alternately along a stylet.',
  ],
};
export const majorParts = [
  'eyes',
  'forewing',
  'hamuli',
  'motor',
  'rings',
  'antennae',
  'core',
  'legs',
];
const materialNames = [
  [
    'Ivory porcelain',
    '24k gilt brass',
    'Smoked optical glass',
    'Etched crown glass',
    'Honey amber',
  ],
  [
    'Cobalt-painted porcelain',
    'Antique brass',
    'Cobalt-glazed glass',
    'Etched crown glass',
    'Honey amber',
  ],
  [
    'Black lacquered enamel',
    'Aged brass',
    'Black optical glass',
    'Smoked thin-film glass',
    'Luminous amber',
  ],
  ['Cream enamel', 'Oxidized bronze', 'Sepia optical glass', 'Etched amber glass', 'Honey amber'],
];
export function partMaterial(id, edition) {
  const [shell, metal, optics, glass, amber] = materialNames[edition];
  if (['eyes', 'ocelli'].includes(id)) return optics + ' · ' + metal;
  if (['forewing', 'hindwing'].includes(id)) return glass + ' · ' + metal;
  if (['head', 'scutum', 'rings'].includes(id) || id.startsWith('leg'))
    return shell + ' · ' + metal;
  if (id === 'core') return amber + ' · ' + metal;
  return metal;
}
