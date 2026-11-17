export const scaleMM = 20
export const dimensions = { span: 186, body: 113, mass: 64, beat: 230, stroke: 90 }

export const parts = {
  housing: {
    name: 'Cranial Housing', caption: 'Glazed cranial shell', material: 'bodyMetal', priority: 6,
    function: 'A glazed shell seats the optical assemblies and pivots on a two-axis neck bearing.',
    fact: 'A honeybee’s head carries its eyes, antennae and mouthparts.',
  },
  eyes: {
    name: 'Compound Eyes', caption: 'Faceted optical domes', material: 'optical', priority: 1,
    function: 'A hexagonal array of polished lenses curves over each smoked optical dome.',
    fact: 'Worker honeybees see ultraviolet patterns on flowers and use polarized skylight to orient themselves.',
  },
  ocelli: {
    name: 'Ocelli Triad', caption: 'Three simple lenses', material: 'optical',
    function: 'Three individually mounted jewels measure changes in sky brightness.',
    fact: 'Each of a bee’s three ocelli has a single lens.',
  },
  antennae: {
    name: 'Antennae', caption: 'Ten flagellomeres per side', material: 'metal',
    function: 'A long scape and short pedicel carry ten flagellomeres on miniature ball joints.',
    fact: 'Antennae detect scent, touch and movement of the surrounding air.',
  },
  mandibles: {
    name: 'Mandibles', caption: 'Paired gripping jaws', material: 'metal',
    function: 'Opposing jaws close around the folded mouthparts on two transverse pins.',
    fact: 'Worker bees use their mandibles to shape wax, among other tasks.',
  },
  proboscis: {
    name: 'Proboscis', caption: 'Articulated glossa', material: 'metal',
    function: 'A hinged feeding tube enfolds a fine, extendable glossa.',
    fact: 'A honeybee folds its proboscis behind the mandibles between meals.',
  },
  plates: {
    name: 'Scutum & Scutellum', caption: 'Sprung dorsal plates', material: 'bodyMetal', priority: 5,
    function: 'The main dorsal shield and smaller rear cover flex with the resonator.',
    fact: 'Indirect flight muscles deform the bee’s thorax to move the wing hinges.',
  },
  motor: {
    name: 'Resonant Flight Motor', caption: '18 / 12 / 15 tooth train', material: 'metal', priority: 2,
    function: 'An eccentric drives stacked leaf springs. Their oscillation flexes the thoracic frame and rocks the wing hinges.',
    fact: 'Worker honeybees can warm their flight muscles by contracting them before takeoff.',
  },
  hinges: {
    name: 'Wing Hinge Assembly', caption: 'Axillary gimbal', material: 'metal',
    function: 'Two nested pivots turn thoracic motion into wing stroke and pitch.',
    fact: 'Small plates called axillary sclerites help a bee control and fold its wings.',
  },
  setae: {
    name: 'Setae', caption: 'Drawn metal filaments', material: 'metal',
    function: 'Tapered filaments on the collar and brow catch changing light and flex with the body.',
    fact: 'Many bee hairs branch, giving pollen grains more places to catch.',
  },
  forewings: {
    name: 'Forewings', caption: 'Marginal and submarginal cells', material: 'wing', priority: 3,
    function: 'A fine frame defines the marginal cell, three submarginal cells and a rolled trailing edge.',
    fact: 'Honeybee forewing venation can help distinguish subspecies.',
  },
  hindwings: {
    name: 'Hindwings', caption: 'Reduced venation', material: 'wing',
    function: 'The shorter rear membranes follow the forewings through the coupled stroke and pitch.',
    fact: 'Honeybees carry four wings even though the coupled pairs move as two surfaces in flight.',
  },
  hamuli: {
    name: 'Hamuli Coupling', caption: '21 hooks per side', material: 'metal', priority: 4,
    function: 'A row of tiny hooks on the hindwing engages the rolled edge of the forewing.',
    fact: 'A worker honeybee typically has about 20–22 hooks on each hindwing.',
  },
  legs: {
    name: 'Leg Assemblies', caption: 'Three paired suspensions', material: 'bodyMetal', priority: 7,
    function: 'A coxa and trochanter support each pinned thigh and shin. Five tarsal links end in a pair of claws.',
    fact: 'The forelegs have a specialized notch for cleaning the antennae.',
  },
  corbicula: {
    name: 'Corbicula', caption: 'Hind tibial basket', material: 'metal',
    function: 'Long, curved filaments guard a concave plate on each hind tibia.',
    fact: 'Workers pack pollen between the curved hairs that border this smooth area.',
  },
  petiole: {
    name: 'Petiole', caption: 'Compliant waist joint', material: 'metal',
    function: 'A narrow bellows and gimbal let the abdomen lag and swing independently of the thorax.',
    fact: 'The narrow connection gives the bee’s abdomen a wide range of movement.',
  },
  tergites: {
    name: 'Tergite Rings', caption: 'Six telescoping plates', material: 'bodyMetal', priority: 2,
    function: 'Six overlapping shells slide axially. Pierced hexagonal windows reveal the amber reactor.',
    fact: 'A bee’s abdominal plates overlap, allowing the abdomen to expand and contract.',
  },
  core: {
    name: 'Amber Core', caption: 'Fused honey-glass reactor', material: 'ember', priority: 5,
    function: 'A warm light fluctuates inside a ribbed reactor, visible through the tergite windows.',
    fact: 'Honeybees have open circulation. Their dorsal vessel runs along the top of the abdomen.',
  },
  sting: {
    name: 'Sting Assembly', caption: 'Sheath and paired lancets', material: 'metal',
    function: 'A tapered sheath guides two fine, barbed lancets at the abdomen tip.',
    fact: 'In a worker bee’s sting, the two barbed lancets slide on a central stylet.',
  },
}

export const partKeys = Object.keys(parts)
